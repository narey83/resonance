using System;
using System.IO;
using System.Net.Sockets;
using Xunit;

namespace Resonance.Tests.Security;

public class ConnectionErrorTests
{
    [Fact]
    public void ConnectionErrorsExposeStableCodesWithoutExceptionDetails()
    {
        Assert.Equal("LOGIN_REJECTED", resonance.ConnectionWatchdog.ConnectionErrorCode(new Soulseek.LoginRejectedException("private")));
        Assert.Equal("TIMEOUT", resonance.ConnectionWatchdog.ConnectionErrorCode(new TimeoutException("private")));
        Assert.Equal("NETWORK_ERROR", resonance.ConnectionWatchdog.ConnectionErrorCode(new SocketException()));
        Assert.Equal("NETWORK_ERROR", resonance.ConnectionWatchdog.ConnectionErrorCode(new IOException("private")));
        Assert.Equal("CONNECTION_FAILED", resonance.ConnectionWatchdog.ConnectionErrorCode(new Exception("private")));
    }
}
