namespace Resonance.Tests.Common;

using global::resonance;

public class ConcurrentFixedSizeQueueTests
{
    [Fact]
    public void Keeps_All_Items_When_Below_Capacity()
    {
        var queue = new ConcurrentFixedSizeQueue<int>(size: 3);

        queue.Enqueue(1);
        queue.Enqueue(2);

        Assert.Equal(2, queue.Count);
        Assert.Equal(new[] { 1, 2 }, queue.ToArray());
    }

    [Fact]
    public void Evicts_Oldest_Items_When_Over_Capacity()
    {
        var queue = new ConcurrentFixedSizeQueue<int>(size: 3);

        foreach (var n in new[] { 1, 2, 3, 4, 5 })
        {
            queue.Enqueue(n);
        }

        // Oldest (1, 2) evicted; newest three retained in FIFO order.
        Assert.Equal(3, queue.Count);
        Assert.Equal(new[] { 3, 4, 5 }, queue.ToArray());
    }

    [Fact]
    public void Never_Exceeds_Capacity_Under_Concurrent_Writers()
    {
        var queue = new ConcurrentFixedSizeQueue<int>(size: 100);

        Parallel.For(0, 10_000, queue.Enqueue);

        Assert.Equal(100, queue.Count);
    }

    [Fact]
    public void Size_Of_One_Retains_Only_The_Last_Item()
    {
        var queue = new ConcurrentFixedSizeQueue<string>(size: 1);

        queue.Enqueue("a");
        queue.Enqueue("b");

        // Assert.Single also verifies the count is exactly one.
        Assert.Equal("b", Assert.Single(queue));
    }
}
