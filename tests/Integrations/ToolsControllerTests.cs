namespace Resonance.Tests.Integrations;

using System.Reflection;
using System.Net;
using System.Net.Http;
using global::resonance;
using global::resonance.Common.Ffmpeg;
using global::resonance.Core.API;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Resonance.Integrations.YtDlp;

public class ToolsControllerTests
{
    [Fact]
    public void ToolInventoryAndUpdatesRequireAdministratorJwt()
    {
        var policy=typeof(ToolsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthPolicy.JwtOnly,policy!.Policy);
        Assert.Equal(AuthRole.AdministratorOnly,policy.Roles);
        foreach(var type in new[]{typeof(global::resonance.Common.Ffmpeg.API.FfmpegController),typeof(Resonance.Integrations.YtDlp.API.Controllers.YtDlpController)})
        {
            var update=type.GetMethods().Single(m=>m.GetCustomAttribute<HttpPostAttribute>()?.Template=="update");
            Assert.Equal(AuthRole.AdministratorOnly,update.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        }
    }

    [Fact]
    public async Task OnlySupportedToolsCanBeInstalledAndFailuresAreReported()
    {
        var calls=new List<string>();
        var youtube=Stub<IYtDlpService>((method,_)=> {calls.Add(method.Name);return Task.FromResult("new");});
        var ffmpeg=Stub<IFfmpegService>((method,_)=> {calls.Add(method.Name);return Task.FromResult("new");});
        var controller=new ToolsController(youtube,ffmpeg,new Clients());
        foreach(var id in new[]{"../../arbitrary","node"})
            Assert.IsType<BadRequestObjectResult>(await controller.Update(id,default));
        Assert.Empty(calls);
        foreach(var id in new[]{"ytdlp","deno","ffmpeg"})
            Assert.IsType<OkObjectResult>(await controller.Update(id,default));
        Assert.Equal(new[]{"UpdateYtDlpAsync","UpdateJavaScriptRuntimeAsync","UpdateAsync"},calls);
        var failing=Stub<IYtDlpService>((_,_)=>Task.FromException<string>(new HttpRequestException("upstream unavailable")));
        var failure=Assert.IsType<ObjectResult>(await new ToolsController(failing,ffmpeg,new Clients()).Update("deno",default));
        Assert.Equal(503,failure.StatusCode);
    }

    [Fact]
    public async Task InventoryDoesNotPretendUncheckedToolsAreCurrent()
    {
        var youtube=Stub<IYtDlpService>((method,_)=>method.Name switch
        {
            "GetVersionsAsync" => Task.FromResult<(string?,string?)>(("2026.10.26","ffmpeg current")),
            "GetJavaScriptRuntimeVersionAsync" => Task.FromResult<(string?,string?)>(("2.9.8",null)),
            _ => throw new NotSupportedException(method.Name),
        });
        var ffmpeg=Stub<IFfmpegService>((_,_)=>Task.FromResult<string?>("ffmpeg current"));
        var response=Assert.IsType<OkObjectResult>(await new ToolsController(youtube,ffmpeg,new Clients()).Get(false,default));
        var rows=Assert.IsType<List<ToolsController.ToolStatus>>(response.Value);
        Assert.Equal(4,rows.Count);
        Assert.All(rows,row=>Assert.Null(row.UpdateAvailable));
        Assert.Equal("2.0.2",rows.Single(row=>row.Id=="bgutil").Current);
    }

    [Fact]
    public async Task BgutilCanCheckUpstreamWhenLocalHelperIsUnavailable()
    {
        var youtube = Stub<IYtDlpService>((method, _) => method.Name switch
        {
            "CheckForUpdateAsync" => Task.FromResult<(string?, string?, bool)>(("current", "current", false)),
            "GetJavaScriptRuntimeVersionAsync" => Task.FromResult<(string?, string?)>(("current", "current")),
            _ => throw new NotSupportedException(method.Name),
        });
        var ffmpeg = Stub<IFfmpegService>((_, _) => Task.FromResult<(string?, string?, bool)>(("current", "current", false)));
        var response = Assert.IsType<OkObjectResult>(await new ToolsController(youtube, ffmpeg, new Clients(localAvailable: false)).Get(true, default));
        var bgutil = Assert.IsType<List<ToolsController.ToolStatus>>(response.Value).Single(row => row.Id == "bgutil");
        Assert.Null(bgutil.Current);
        Assert.Equal("2.0.2", bgutil.Latest);
        Assert.True(bgutil.UpdateAvailable);
    }

    private static T Stub<T>(Func<MethodInfo,object?[]?,object?> invoke) where T:class
    {
        var proxy=DispatchProxy.Create<T,Proxy>();((Proxy)(object)proxy).Call=invoke;return proxy;
    }
    public class Proxy:DispatchProxy
    {
        public Func<MethodInfo,object?[]?,object?> Call=null!;
        protected override object? Invoke(MethodInfo? targetMethod,object?[]? args)=>Call(targetMethod!,args);
    }
    private sealed class Clients(bool localAvailable = true):IHttpClientFactory
    {
        public HttpClient CreateClient(string name)=>new(new Handler(localAvailable));
    }
    private sealed class Handler(bool localAvailable):HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.IsLoopback && !localAvailable)
            {
                throw new HttpRequestException("Local helper is unavailable.");
            }

            var json = request.RequestUri.IsLoopback ? "{\"version\":\"2.0.2\"}" : "{\"tag_name\":\"2.0.2\"}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
        }
    }
}
