using System;
using System.Runtime.InteropServices;
using System.Text.Json;

// LS03D ARM32: verified against VideoEnhancerImpl::get_colorsensor_info and
// ecs_ecosensor::GetColorSensorInfo. Eight consecutive signed 32-bit values.
// Only getters: this helper never enables sensors or changes picture settings.
internal static class SamsungFrameSensor
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ColorInfo { public int A, B, C, D, E, Lux, Cct, Ic; }
    [DllImport("libvideoenhance.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ve_get_colorsensor_info(ref ColorInfo info);
    [DllImport("libvideoenhance.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern int ve_get_sensor_detected(out int value);
    public static int Main()
    {
        try
        {
            var c = new ColorInfo { A=-1, B=-1, C=-1, D=-1, E=-1, Lux=-1, Cct=-1, Ic=-1 };
            int dr = ve_get_sensor_detected(out int detected);
            int cr = ve_get_colorsensor_info(ref c);
            Console.WriteLine(JsonSerializer.Serialize(new {
                schema=1, detected_status=dr, detected, color_status=cr,
                raw=new[] { c.A,c.B,c.C,c.D,c.E }, lux=c.Lux, cct=c.Cct, ic=c.Ic
            }));
            return dr == 0 && cr == 0 && detected == 1 ? 0 : 1;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
