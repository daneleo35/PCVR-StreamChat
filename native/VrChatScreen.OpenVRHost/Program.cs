using System.Globalization;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using Valve.VR;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

var options = HostOptions.Parse(args);
var framePath = Path.GetFullPath(options.FramePath);
Directory.CreateDirectory(Path.GetDirectoryName(framePath)!);

Console.WriteLine($"VR Chat Screen OpenVR host starting. Frame: {framePath}");

EVRInitError initError = EVRInitError.None;
OpenVR.Init(ref initError, EVRApplicationType.VRApplication_Overlay);

if (initError != EVRInitError.None)
{
    Console.Error.WriteLine($"OpenVR init failed: {initError}");
    Environment.Exit((int)initError);
}

var overlay = OpenVR.Overlay;
if (overlay is null)
{
    Console.Error.WriteLine("OpenVR overlay interface is unavailable.");
    Environment.Exit(2);
}

ulong handle = OpenVR.k_ulOverlayHandleInvalid;
var createError = overlay.CreateOverlay(options.OverlayKey, options.OverlayName, ref handle);
if (createError == EVROverlayError.KeyInUse)
{
    createError = overlay.FindOverlay(options.OverlayKey, ref handle);
}

Require(createError, "CreateOverlay/FindOverlay");
Require(overlay.SetOverlayWidthInMeters(handle, options.WidthMeters), "SetOverlayWidthInMeters");
Require(overlay.SetOverlayAlpha(handle, options.Alpha), "SetOverlayAlpha");
var interactiveWorld = false;
Require(overlay.SetOverlayInputMethod(handle, VROverlayInputMethod.None), "SetOverlayInputMethod");
overlay.SetOverlayFlag(handle, VROverlayFlags.VisibleInDashboard, true);

var pose = Pose.FromOptions(options);
var transform = options.Anchor == OverlayAnchor.World
    ? Matrix34.FromPose(pose)
    : Matrix34.FromPose(options);
if (options.Anchor == OverlayAnchor.World)
{
    Require(overlay.SetOverlayTransformAbsolute(handle, ETrackingUniverseOrigin.TrackingUniverseStanding, ref transform), "SetOverlayTransformAbsolute");
}
else
{
    var system = OpenVR.System;
    if (system is null)
    {
        Console.Error.WriteLine("OpenVR system interface is unavailable.");
        Environment.Exit(3);
    }

    uint deviceIndex;
    if (options.Anchor == OverlayAnchor.Hmd)
    {
        deviceIndex = OpenVR.k_unTrackedDeviceIndex_Hmd;
    }
    else
    {
        var role = options.Anchor == OverlayAnchor.LeftController
            ? ETrackedControllerRole.LeftHand
            : ETrackedControllerRole.RightHand;
        deviceIndex = system.GetTrackedDeviceIndexForControllerRole(role);
    }
    if (deviceIndex == OpenVR.k_unTrackedDeviceIndexInvalid)
    {
        Console.Error.WriteLine($"{options.Anchor} was not found. Falling back to world placement.");
        var fallback = Matrix34.FromWorldFallback(options);
        Require(overlay.SetOverlayTransformAbsolute(handle, ETrackingUniverseOrigin.TrackingUniverseStanding, ref fallback), "SetOverlayTransformAbsoluteFallback");
    }
    else
    {
        Require(overlay.SetOverlayTransformTrackedDeviceRelative(handle, deviceIndex, ref transform), "SetOverlayTransformTrackedDeviceRelative");
    }
}

Require(overlay.ShowOverlay(handle), "ShowOverlay");

Console.WriteLine($"OpenVR overlay is visible. Anchor={options.Anchor}, Preset={options.Preset}, Width={options.WidthMeters:0.00}m.");

var lastWrite = DateTime.MinValue;
var lastLength = -1L;
var running = true;
var interaction = OverlayInteraction.None;
var textureRenderer = options.TextureMode ? D3D11OverlayTextureRenderer.TryCreate() : null;
var textureReceiver = textureRenderer is not null ? TextureFrameReceiver.Start(Console.OpenStandardInput()) : null;
var visibilityTick = 0;
if (textureRenderer is not null)
{
    Console.WriteLine("OpenVR texture mode is active.");
}
else if (options.TextureMode)
{
    Console.Error.WriteLine("OpenVR texture mode failed to initialize. Falling back to PNG file mode.");
}
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    running = false;
};

while (running)
{
    visibilityTick++;
    if (visibilityTick >= 20)
    {
        visibilityTick = 0;
        try
        {
            if (!overlay.IsOverlayVisible(handle))
            {
                var showError = overlay.ShowOverlay(handle);
                if (showError == EVROverlayError.None)
                {
                    Console.WriteLine("OpenVR overlay became hidden; ShowOverlay called again.");
                }
                else
                {
                    Console.Error.WriteLine($"ShowOverlay retry failed: {showError}");
                }
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Overlay visibility check failed: {error.Message}");
        }
    }

    if (HandleOverlayEvents(overlay, handle, interactiveWorld, ref pose, ref interaction))
    {
        transform = Matrix34.FromPose(pose);
        Require(overlay.SetOverlayTransformAbsolute(handle, ETrackingUniverseOrigin.TrackingUniverseStanding, ref transform), "SetOverlayTransformAbsoluteDrag");
        Require(overlay.SetOverlayWidthInMeters(handle, pose.WidthMeters), "SetOverlayWidthInMetersDrag");
        Console.WriteLine("CONFIG " + JsonSerializer.Serialize(new
        {
            widthMeters = pose.WidthMeters,
            x = pose.X,
            y = pose.Y,
            z = pose.Z,
            pitch = pose.Pitch,
            yaw = pose.Yaw,
            roll = pose.Roll
        }));
    }

    if (textureRenderer is not null && textureReceiver is not null && textureReceiver.TryDequeue(out var frameBytes))
    {
        while (textureReceiver.TryDequeue(out var newerFrameBytes))
        {
            frameBytes = newerFrameBytes;
        }

        var texture = textureRenderer.Update(frameBytes);
        if (texture.HasValue)
        {
            var openVrTexture = texture.Value;
            var error = overlay.SetOverlayTexture(handle, ref openVrTexture);
            if (error != EVROverlayError.None)
            {
                Console.Error.WriteLine($"SetOverlayTexture failed: {error}");
                textureReceiver.Dispose();
                textureReceiver = null;
                textureRenderer.Dispose();
                textureRenderer = null;
                Console.Error.WriteLine("OpenVR texture mode disabled for this session. Falling back to PNG file mode.");
            }
        }
    }
    else if (File.Exists(framePath))
    {
        var info = new FileInfo(framePath);
        if (info.Length > 0 && (info.LastWriteTimeUtc != lastWrite || info.Length != lastLength))
        {
            var error = TrySetOverlayFromFileWithRetry(overlay, handle, framePath);
            if (error == EVROverlayError.None)
            {
                lastWrite = info.LastWriteTimeUtc;
                lastLength = info.Length;
            }
            else
            {
                Console.Error.WriteLine($"SetOverlayFromFile failed: {error}");
            }
        }
    }

    Thread.Sleep(options.FrameIntervalMs);
}

overlay.HideOverlay(handle);
overlay.DestroyOverlay(handle);
textureReceiver?.Dispose();
textureRenderer?.Dispose();
OpenVR.Shutdown();
Console.WriteLine("VR Chat Screen OpenVR host stopped.");

static void Require(EVROverlayError error, string operation)
{
    if (error == EVROverlayError.None)
    {
        return;
    }

    Console.Error.WriteLine($"{operation} failed: {error}");
    OpenVR.Shutdown();
    Environment.Exit(10 + (int)error);
}

static EVROverlayError TrySetOverlayFromFileWithRetry(CVROverlay overlay, ulong handle, string framePath, int attempts = 4)
{
    EVROverlayError lastError = EVROverlayError.None;
    for (var attempt = 0; attempt < attempts; attempt++)
    {
        lastError = overlay.SetOverlayFromFile(handle, framePath);
        if (lastError == EVROverlayError.None)
        {
            return lastError;
        }

        if (attempt < attempts - 1)
        {
            Thread.Sleep(15 + (attempt * 20));
        }
    }

    return lastError;
}

static bool HandleOverlayEvents(CVROverlay overlay, ulong handle, bool interactiveWorld, ref Pose pose, ref OverlayInteraction interaction)
{
    var changed = false;
    var vrEvent = new VREvent_t();
    var eventSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<VREvent_t>();

    while (overlay.PollNextOverlayEvent(handle, ref vrEvent, eventSize))
    {
        var eventType = (EVREventType)vrEvent.eventType;
        var mouse = vrEvent.data.mouse;

        switch (eventType)
        {
            case EVREventType.VREvent_MouseButtonDown:
                if ((EVRMouseButton)mouse.button != EVRMouseButton.Left)
                {
                    break;
                }

                interaction = interactiveWorld ? OverlayInteraction.Begin(mouse.x, mouse.y, pose) : OverlayInteraction.None;
                if (!interaction.Active)
                {
                    EmitInput("down", mouse.x, mouse.y);
                }
                break;

            case EVREventType.VREvent_MouseButtonUp:
                if (!interaction.Active)
                {
                    EmitInput("up", mouse.x, mouse.y);
                }
                interaction = OverlayInteraction.None;
                break;

            case EVREventType.VREvent_MouseMove:
                if (!interaction.Active)
                {
                    EmitInput("move", mouse.x, mouse.y);
                    break;
                }

                pose = interaction.Apply(mouse.x, mouse.y);
                changed = true;
                break;

            case EVREventType.VREvent_Scroll:
                if (!interaction.Active)
                {
                    var scroll = vrEvent.data.scroll;
                    EmitScroll(mouse.x, mouse.y, scroll.xdelta, scroll.ydelta, scroll.repeatCount);
                }
                break;
        }
    }

    return changed;
}

static void EmitInput(string type, float x, float y)
{
    Console.WriteLine("INPUT " + JsonSerializer.Serialize(new
    {
        type,
        x,
        y
    }));
}

static void EmitScroll(float x, float y, float deltaX, float deltaY, uint repeatCount)
{
    Console.WriteLine("INPUT " + JsonSerializer.Serialize(new
    {
        type = "scroll",
        x,
        y,
        deltaX = deltaX * 120.0f * Math.Max(1, repeatCount),
        deltaY = deltaY * 120.0f * Math.Max(1, repeatCount)
    }));
}

internal sealed record HostOptions(
    string FramePath,
    string OverlayKey,
    string OverlayName,
    OverlayAnchor Anchor,
    ControllerPreset Preset,
    float WidthMeters,
    float Alpha,
    float X,
    float Y,
    float Z,
    float Pitch,
    float Yaw,
    float Roll,
    int FrameIntervalMs,
    bool WorldGrabMode,
    bool WorldLocked,
    bool TextureMode)
{
    public static HostOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var key = args[index][2..];
            var value = index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal)
                ? args[++index]
                : "true";
            values[key] = value;
        }

        return new HostOptions(
            Get(values, "frame", Path.Combine(AppContext.BaseDirectory, "overlay-frame.png")),
            Get(values, "key", "com.codex.vrchatscreen.overlay"),
            Get(values, "name", "VR Chat Screen"),
            GetAnchor(values, "anchor", OverlayAnchor.World),
            GetPreset(values, "preset", ControllerPreset.Custom),
            GetFloat(values, "width", 0.28f),
            GetFloat(values, "alpha", 0.95f),
            GetFloat(values, "x", 0.0f),
            GetFloat(values, "y", 1.35f),
            GetFloat(values, "z", -1.35f),
            GetFloat(values, "pitch", 0.0f),
            GetFloat(values, "yaw", 0.0f),
            GetFloat(values, "roll", 0.0f),
            Math.Clamp(GetInt(values, "interval", 250), 50, 2000),
            GetBool(values, "grab", false),
            GetBool(values, "locked", true),
            GetBool(values, "texture", false));
    }

    private static string Get(IReadOnlyDictionary<string, string> values, string key, string fallback)
    {
        return values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : fallback;
    }

    private static float GetFloat(IReadOnlyDictionary<string, string> values, string key, float fallback)
    {
        return values.TryGetValue(key, out var value) &&
               float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static int GetInt(IReadOnlyDictionary<string, string> values, string key, int fallback)
    {
        return values.TryGetValue(key, out var value) &&
               int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static bool GetBool(IReadOnlyDictionary<string, string> values, string key, bool fallback)
    {
        return values.TryGetValue(key, out var value) && bool.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private static OverlayAnchor GetAnchor(IReadOnlyDictionary<string, string> values, string key, OverlayAnchor fallback)
    {
        return values.TryGetValue(key, out var value) && Enum.TryParse<OverlayAnchor>(value, true, out var parsed)
            ? parsed
            : fallback;
    }

    private static ControllerPreset GetPreset(IReadOnlyDictionary<string, string> values, string key, ControllerPreset fallback)
    {
        return values.TryGetValue(key, out var value) && Enum.TryParse<ControllerPreset>(value, true, out var parsed)
            ? parsed
            : fallback;
    }
}

internal enum OverlayAnchor
{
    World,
    Hmd,
    LeftController,
    RightController
}

internal enum ControllerPreset
{
    Custom,
    Top,
    Behind,
    WristSide
}

internal readonly record struct Pose(float X, float Y, float Z, float Pitch, float Yaw, float Roll, float WidthMeters)
{
    public static Pose FromOptions(HostOptions options)
    {
        return new Pose(options.X, options.Y, options.Z, options.Pitch, options.Yaw, options.Roll, options.WidthMeters);
    }
}

internal readonly record struct OverlayInteraction(
    bool Active,
    bool Resize,
    int ResizeDirection,
    float StartMouseX,
    float StartMouseY,
    Pose StartPose)
{
    private const float MouseScale = 1000.0f;
    private const float EdgePixels = 24.0f;
    private const float DragBandPixels = 10.0f;

    public static OverlayInteraction None => new(false, false, 0, 0.0f, 0.0f, default);

    public static OverlayInteraction Begin(float mouseX, float mouseY, Pose pose)
    {
        var nearLeft = mouseX <= EdgePixels;
        var nearRight = mouseX >= MouseScale - EdgePixels;
        var resize = nearLeft || nearRight;
        var allowDrag = mouseY <= DragBandPixels;
        if (!resize && !allowDrag)
        {
            return None;
        }
        var direction = nearLeft ? -1 : 1;
        return new OverlayInteraction(true, resize, direction, mouseX, mouseY, pose);
    }

    public Pose Apply(float mouseX, float mouseY)
    {
        var dx = (mouseX - StartMouseX) / MouseScale;
        var dy = (mouseY - StartMouseY) / MouseScale;

        if (Resize)
        {
            var width = Math.Clamp(StartPose.WidthMeters + (dx * ResizeDirection * StartPose.WidthMeters), 0.02f, 2.0f);
            return StartPose with { WidthMeters = width };
        }

        var matrix = Matrix34.RotationMatrix(StartPose.Pitch, StartPose.Yaw, StartPose.Roll + 180.0f);
        var right = new Vector3(matrix[0, 0], matrix[1, 0], matrix[2, 0]);
        var up = new Vector3(matrix[0, 1], matrix[1, 1], matrix[2, 1]);
        var moveX = dx * StartPose.WidthMeters;
        var moveY = -dy * StartPose.WidthMeters;

        return StartPose with
        {
            X = StartPose.X + right.X * moveX + up.X * moveY,
            Y = StartPose.Y + right.Y * moveX + up.Y * moveY,
            Z = StartPose.Z + right.Z * moveX + up.Z * moveY
        };
    }
}

internal readonly record struct Vector3(float X, float Y, float Z);

internal sealed class TextureFrameReceiver : IDisposable
{
    private readonly BlockingCollection<byte[]> _frames = new(new ConcurrentQueue<byte[]>());
    private readonly CancellationTokenSource _cancellation = new();
    private readonly Task _reader;

    private TextureFrameReceiver(Stream input)
    {
        _reader = Task.Run(() => ReadLoop(input, _cancellation.Token));
    }

    public static TextureFrameReceiver Start(Stream input)
    {
        return new TextureFrameReceiver(input);
    }

    public bool TryDequeue(out byte[] frame)
    {
        return _frames.TryTake(out frame!);
    }

    private async Task ReadLoop(Stream input, CancellationToken cancellation)
    {
        var header = new byte[4];
        while (!cancellation.IsCancellationRequested)
        {
            if (!await ReadExact(input, header, cancellation))
            {
                break;
            }

            var length = BitConverter.ToInt32(header, 0);
            if (length <= 0 || length > 32 * 1024 * 1024)
            {
                break;
            }

            var bytes = new byte[length];
            if (!await ReadExact(input, bytes, cancellation))
            {
                break;
            }

            _frames.Add(bytes, cancellation);
        }
    }

    private static async Task<bool> ReadExact(Stream stream, byte[] buffer, CancellationToken cancellation)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellation);
            if (read == 0)
            {
                return false;
            }

            offset += read;
        }

        return true;
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        _frames.Dispose();
        _cancellation.Dispose();
    }
}

internal sealed class D3D11OverlayTextureRenderer : IDisposable
{
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private ID3D11Texture2D? _texture;
    private int _width;
    private int _height;

    private D3D11OverlayTextureRenderer(ID3D11Device device, ID3D11DeviceContext context)
    {
        _device = device;
        _context = context;
    }

    public static D3D11OverlayTextureRenderer? TryCreate()
    {
        try
        {
            var featureLevels = new[]
            {
                FeatureLevel.Level_11_1,
                FeatureLevel.Level_11_0,
                FeatureLevel.Level_10_1,
                FeatureLevel.Level_10_0
            };

            var device = D3D11.D3D11CreateDevice(DriverType.Hardware, DeviceCreationFlags.BgraSupport, featureLevels);
            var context = device.ImmediateContext;

            return new D3D11OverlayTextureRenderer(device, context);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"D3D11CreateDevice failed: {error.Message}");
            return null;
        }
    }

    public Texture_t? Update(byte[] pngBytes)
    {
        try
        {
            using var stream = new MemoryStream(pngBytes);
            using var source = new Bitmap(stream);
            using var bitmap = source.PixelFormat == PixelFormat.Format32bppArgb
                ? source
                : source.Clone(new Rectangle(0, 0, source.Width, source.Height), PixelFormat.Format32bppArgb);

            EnsureTexture(bitmap.Width, bitmap.Height);
            if (_texture is null)
            {
                return null;
            }

            var rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            var data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                _context.UpdateSubresource(_texture, 0, null, data.Scan0, (uint)data.Stride, (uint)(data.Stride * bitmap.Height));
            }
            finally
            {
                bitmap.UnlockBits(data);
            }

            return new Texture_t
            {
                handle = _texture.NativePointer,
                eType = ETextureType.DirectX,
                eColorSpace = EColorSpace.Gamma
            };
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Texture frame update failed: {error.Message}");
            return null;
        }
    }

    private void EnsureTexture(int width, int height)
    {
        if (_texture is not null && _width == width && _height == height)
        {
            return;
        }

        _texture?.Dispose();
        _width = width;
        _height = height;
        var description = new Texture2DDescription
        {
            Width = (uint)width,
            Height = (uint)height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource,
            CPUAccessFlags = CpuAccessFlags.None,
            MiscFlags = ResourceOptionFlags.None
        };

        _texture = _device.CreateTexture2D(in description);
    }

    public void Dispose()
    {
        _texture?.Dispose();
        _context.Dispose();
        _device.Dispose();
    }
}

internal static class Matrix34
{
    public static HmdMatrix34_t FromWorldFallback(HostOptions options)
    {
        return FromRaw(0.0f, 1.35f, -1.2f, 0.0f, 0.0f, 180.0f);
    }

    public static HmdMatrix34_t FromPose(Pose pose)
    {
        return FromRaw(pose.X, pose.Y, pose.Z, pose.Pitch, pose.Yaw, pose.Roll + 180.0f);
    }

    public static HmdMatrix34_t FromPose(HostOptions options)
    {
        var x = options.X;
        var y = options.Y;
        var z = options.Z;
        var pitch = options.Pitch;
        var yaw = options.Yaw;
        var roll = options.Roll;

        if (options.Anchor != OverlayAnchor.World)
        {
            var outsideWristX = options.Anchor == OverlayAnchor.RightController ? 0.05f : -0.05f;
            var outsideWristYaw = options.Anchor == OverlayAnchor.RightController ? 90.0f : -90.0f;
            var outsideWristRoll = options.Anchor == OverlayAnchor.RightController ? -15.0f : 15.0f;

            (x, y, z, pitch, yaw, roll) = options.Preset switch
            {
                ControllerPreset.Top => (0.0f, 0.16f, -0.06f, 55.0f, 0.0f, 180.0f),
                ControllerPreset.Behind => (0.0f, -0.08f, 0.10f, 35.0f, 180.0f, 180.0f),
                ControllerPreset.WristSide => (outsideWristX, 0.08f, 0.18f, -25.0f, outsideWristYaw, outsideWristRoll),
                _ => (x, y, z, pitch, yaw, roll)
            };

            if (options.Preset != ControllerPreset.Custom)
            {
                x += options.X;
                y += options.Y;
                z += options.Z;
                pitch += options.Pitch;
                yaw += options.Yaw;
                roll += options.Roll;
            }
        }

        return FromRaw(x, y, z, pitch, yaw, roll + 180.0f);
    }

    private static HmdMatrix34_t FromRaw(float x, float y, float z, float pitch, float yaw, float roll)
    {
        var matrix = RotationMatrix(pitch, yaw, roll);
        return new HmdMatrix34_t
        {
            m0 = matrix[0, 0],
            m1 = matrix[0, 1],
            m2 = matrix[0, 2],
            m3 = x,
            m4 = matrix[1, 0],
            m5 = matrix[1, 1],
            m6 = matrix[1, 2],
            m7 = y,
            m8 = matrix[2, 0],
            m9 = matrix[2, 1],
            m10 = matrix[2, 2],
            m11 = z
        };
    }

    public static float[,] RotationMatrix(float pitchDegrees, float yawDegrees, float rollDegrees)
    {
        var pitch = DegreesToRadians(pitchDegrees);
        var yaw = DegreesToRadians(yawDegrees);
        var roll = DegreesToRadians(rollDegrees);

        var cp = MathF.Cos(pitch);
        var sp = MathF.Sin(pitch);
        var cy = MathF.Cos(yaw);
        var sy = MathF.Sin(yaw);
        var cr = MathF.Cos(roll);
        var sr = MathF.Sin(roll);

        return new[,]
        {
            { cy * cr + sy * sp * sr, sr * cp, -sy * cr + cy * sp * sr },
            { -cy * sr + sy * sp * cr, cr * cp, sr * sy + cy * sp * cr },
            { sy * cp, -sp, cy * cp }
        };
    }

    private static float DegreesToRadians(float degrees)
    {
        return degrees * MathF.PI / 180.0f;
    }
}
