namespace Resonance.Tests.Common;

using global::resonance;

public class LogsRegistryTests
{
    [Fact]
    public void All_Includes_Top_Level_And_Nested_Contexts()
    {
        Assert.Contains(Logs.Application, Logs.All);
        Assert.Contains(Logs.Transfers.Uploads, Logs.All);
        Assert.Contains(Logs.Integrations.YtDlp, Logs.All);
        Assert.Contains(Logs.Music.Ffmpeg, Logs.All);
    }

    [Fact]
    public void All_Is_Sorted_And_Free_Of_Duplicates()
    {
        Assert.Equal(Logs.All.Distinct().Count(), Logs.All.Count);
        Assert.Equal(Logs.All.OrderBy(c => c, StringComparer.OrdinalIgnoreCase), Logs.All);
    }

    [Fact]
    public void All_Contains_Every_Context_Emitted_By_The_Backend()
    {
        // The UI builds its filter list from this, so a context missing here is a context the
        // user can never filter on.  Guards against adding a constant to a new nested group and
        // having the reflection walk quietly skip it.
        var declared = typeof(Logs)
            .GetNestedTypes()
            .SelectMany(t => t.GetFields())
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!);

        Assert.All(declared, context => Assert.Contains(context, Logs.All));
    }
}
