namespace HyperCore;

/// `HyperCore --fan-cal <out.txt>` (admin): measures what each custom fan percentage really means on this
/// laptop, steps 10% → 100% and reads the RPM, then hands the fans back to the firmware.
static class FanCal
{
    public static int Run(string[] args)
    {
        int i = Array.IndexOf(args, "--fan-cal");
        var outFile = i + 1 < args.Length ? args[i + 1] : Path.Combine(Path.GetTempPath(), "hs-fancal.txt");
        var lines = new List<string>();
        void W(string s) { lines.Add(s); File.WriteAllLines(outFile, lines); }
        var acer = new Acer();
        if (!acer.Ok) { W("ERROR acer: " + acer.Error); return 1; }
        (int? c, int? g) Rpm()
        {
            int cs = 0, gs = 0, n = 0;
            for (int k = 0; k < 3; k++) { var c = acer.Sensor(0x02); var g = acer.Sensor(0x06); if (c != null && g != null) { cs += c.Value; gs += g.Value; n++; } Thread.Sleep(400); }
            return n == 0 ? (null, null) : (cs / n, gs / n);
        }
        try
        {
            var a = Rpm();
            W($"auto: cpu {acer.Sensor(0x01)}C gpu {acer.Sensor(0x0A)}C  fans {a.c} / {a.g} rpm  profile {acer.Profile()}");
            if (!acer.SetFanBehavior(Acer.FanCustom, Acer.FanCustom)) { W("ERROR custom mode rejected: " + acer.Error); return 1; }
            foreach (var pct in new[] { 0, 10, 20, 30, 40, 50, 60, 70, 80, 100 })
            {
                acer.SetFanSpeed(Acer.CpuFan, pct);
                acer.SetFanSpeed(Acer.GpuFan, pct);
                Thread.Sleep(5000);
                var r = Rpm();
                W($"{pct,3}%: cpu fan {r.c,5} rpm   gpu fan {r.g,5} rpm   (cpu {acer.Sensor(0x01)}C)");
            }
            acer.SetFanBehavior(Acer.FanMax, Acer.FanMax);
            Thread.Sleep(5000);
            var m = Rpm();
            W($"max: cpu fan {m.c} rpm   gpu fan {m.g} rpm");
        }
        catch (Exception e) { W("ERROR " + e.Message); }
        finally
        {
            acer.SetFanBehavior(Acer.FanAuto, Acer.FanAuto);
            W("restored: auto");
        }
        return 0;
    }
}
