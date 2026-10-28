// NuGet oracle, run by run.sh with NuGet.Versioning pinned in Oracle.csproj and packages.lock.json.
// Usage: dotnet run -- <versions> <pairs> <ranges> <range-rows> <validity-out> <pairs-out>
//   <ranges-out>
// A version is valid if NuGetVersion.TryParse accepts it; each pair of valid versions is written as
// `a <op> b` using VersionComparer.Default. Each range is written as `valid-range <r>` or
// `invalid-range <r>` by VersionRange.TryParse without floating versions, which polyver does not
// support, and each `version<TAB>range` row with a valid version and range as
// `version satisfies|fails range` by VersionRange.Satisfies.
using NuGet.Versioning;

static string[] Lines(string path) => File.ReadAllText(path).TrimEnd('\n').Split('\n');

static StreamWriter Create(string path) => new(path) { NewLine = "\n" };

var valid = new Dictionary<string, NuGetVersion>();
using (var w = Create(args[4]))
{
    foreach (var v in Lines(args[0]))
    {
        var ok = NuGetVersion.TryParse(v, out var parsed);
        if (ok) valid[v] = parsed!;
        w.WriteLine($"{(ok ? "valid" : "invalid")} {v}");
    }
}

using (var w = Create(args[5]))
{
    foreach (var line in Lines(args[1]))
    {
        var parts = line.Split(' ');
        if (!valid.TryGetValue(parts[0], out var a) || !valid.TryGetValue(parts[1], out var b))
        {
            continue;
        }
        var op = VersionComparer.Default.Compare(a, b) switch { < 0 => "<", 0 => "=", _ => ">" };
        w.WriteLine($"{parts[0]} {op} {parts[1]}");
    }
}

var ranges = new Dictionary<string, VersionRange>();
using (var w = Create(args[6]))
{
    foreach (var r in Lines(args[2]))
    {
        var ok = VersionRange.TryParse(r, allowFloating: false, out var parsed);
        if (ok) ranges[r] = parsed!;
        w.WriteLine($"{(ok ? "valid" : "invalid")}-range {r}");
    }
    foreach (var line in Lines(args[3]))
    {
        var parts = line.Split('\t');
        if (!valid.TryGetValue(parts[0], out var v) || !ranges.TryGetValue(parts[1], out var range))
        {
            continue;
        }
        w.WriteLine($"{parts[0]} {(range.Satisfies(v) ? "satisfies" : "fails")} {parts[1]}");
    }
}
