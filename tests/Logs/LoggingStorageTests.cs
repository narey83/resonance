namespace Resonance.Tests.Logs;
using global::resonance;
using global::resonance.Core.LogStore;
public class LoggingStorageTests
{
    [Fact] public void DefaultIsDatabaseOnly()
    {
        Assert.True(LoggingStorage.Database(new Options.LoggerOptions()));
        Assert.False(LoggingStorage.Disk(new Options.LoggerOptions()));
    }
    [Theory]
    [InlineData("Database",true,false)]
    [InlineData("Disk",false,true)]
    [InlineData("Both",true,true)]
    public void ExplicitModeTakesPrecedenceOverLegacyFlags(string storage,bool database,bool disk)
    {
        var options=new Options.LoggerOptions {Storage=storage,Database=false,Disk=true,Postgres=true};
        Assert.Equal(database,LoggingStorage.Database(options));
        Assert.Equal(disk,LoggingStorage.Disk(options));
    }
    [Fact] public void InvalidModeFails()
    {
        Assert.Throws<ArgumentException>(()=>LoggingStorage.Database(new Options.LoggerOptions{Storage="Missing"}));
    }
}
