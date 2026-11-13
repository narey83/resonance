namespace Resonance.Tests.Messaging;

using System.Net;
using System.Net.Http;
using global::resonance.LinkPreview.API;
using global::resonance.LinkPreview.API.Controllers;
using Microsoft.AspNetCore.Mvc;

public class LinkPreviewControllerTests
{
    [Theory]
    [InlineData("https://youtu.be/J-PYqUHfTMA?si=share")]
    [InlineData("https://www.youtube.com/watch?v=J-PYqUHfTMA")]
    [InlineData("https://m.youtube.com/shorts/J-PYqUHfTMA")]
    public async Task YouTubeVideosUseOembedMetadata(string url)
    {
        var requests = new List<Uri>();
        var controller = new LinkPreviewController(new Clients(request =>
        {
            requests.Add(request);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"title\":\"Eighth Wonder\",\"thumbnail_url\":\"https://i.ytimg.com/vi/J-PYqUHfTMA/hqdefault.jpg\"}",
                    System.Text.Encoding.UTF8, "application/json"),
            };
        }));

        var result = Assert.IsType<OkObjectResult>(await controller.Get(url));
        var preview = Assert.IsType<LinkPreviewResponse>(result.Value);
        Assert.Equal("Eighth Wonder", preview.Title);
        Assert.Equal("YouTube", preview.SiteName);
        Assert.Equal("https://i.ytimg.com/vi/J-PYqUHfTMA/hqdefault.jpg", preview.ImageUrl);
        Assert.Equal(url, preview.Url);
        Assert.Single(requests);
        Assert.Equal("www.youtube.com", requests[0].Host);
        Assert.Equal("/oembed", requests[0].AbsolutePath);
        Assert.Contains("J-PYqUHfTMA", requests[0].Query);
    }

    [Fact]
    public async Task UnrecognisedHostDoesNotUseYouTubeOembed()
    {
        var requests = new List<Uri>();
        var controller = new LinkPreviewController(new Clients(request =>
        {
            requests.Add(request);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("<html><title>Other site</title></html>",
                    System.Text.Encoding.UTF8, "text/html"),
            };
        }));

        var result = Assert.IsType<OkObjectResult>(await controller.Get("https://youtube.com.evil.example/watch?v=J-PYqUHfTMA"));
        Assert.Equal("Other site", Assert.IsType<LinkPreviewResponse>(result.Value).Title);
        Assert.Single(requests);
        Assert.Equal("youtube.com.evil.example", requests[0].Host);
    }

    [Fact]
    public async Task OembedFailureFallsBackToPageMetadata()
    {
        var requests = new List<Uri>();
        var controller = new LinkPreviewController(new Clients(request =>
        {
            requests.Add(request);
            return request.AbsolutePath == "/oembed"
                ? new HttpResponseMessage(HttpStatusCode.NotFound)
                : new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("<html><title>Fallback title</title></html>",
                        System.Text.Encoding.UTF8, "text/html"),
                };
        }));

        var result = Assert.IsType<OkObjectResult>(await controller.Get("https://youtu.be/abcdefghijk"));
        Assert.Equal("Fallback title", Assert.IsType<LinkPreviewResponse>(result.Value).Title);
        Assert.Equal(2, requests.Count);
    }

    private sealed class Clients(Func<Uri, HttpResponseMessage> reply) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(reply));
    }

    private sealed class Handler(Func<Uri, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(reply(request.RequestUri!));
    }
}
