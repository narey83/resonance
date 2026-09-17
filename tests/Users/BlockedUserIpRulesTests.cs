namespace Resonance.Tests.Users;

using BlockedUsersService = global::resonance.Users.Blocking.BlockedUsersService;

/// <summary>
///     Covers the decision to skip resolving a peer's address.
/// </summary>
/// <remarks>
///     Resolving an address is a server round-trip with a five-second timeout, taken on the path of every
///     search we can answer, and a timeout there used to discard the response entirely. It is skipped when
///     no address-based rule could act on the result — so this must not answer "no rules" while a rule
///     that would have blocked someone is in force.
/// </remarks>
public class BlockedUserIpRulesTests
{
    [Fact]
    public void Nothing_Configured_Needs_No_Address()
    {
        Assert.False(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: false, blockedUsernames: 0, knownBlockedIps: 0, ipRanges: 0, places: 0, geoAvailable: false));
    }

    // The default state of a clean installation: same-IP blocking is on, but nobody is blocked, so it can
    // neither learn an address nor match one. This is the case that makes the skip worth having.
    [Fact]
    public void Same_Ip_Blocking_With_Nobody_Blocked_Needs_No_Address()
    {
        Assert.False(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: true, blockedUsernames: 0, knownBlockedIps: 0, ipRanges: 0, places: 0, geoAvailable: true));
    }

    [Fact]
    public void Same_Ip_Blocking_Needs_An_Address_Once_Someone_Is_Blocked()
    {
        Assert.True(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: true, blockedUsernames: 1, knownBlockedIps: 0, ipRanges: 0, places: 0, geoAvailable: false));
    }

    [Fact]
    public void Same_Ip_Blocking_Needs_An_Address_Once_One_Has_Been_Learned()
    {
        Assert.True(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: true, blockedUsernames: 0, knownBlockedIps: 1, ipRanges: 0, places: 0, geoAvailable: false));
    }

    [Fact]
    public void Blocked_Users_Alone_Need_No_Address_When_Same_Ip_Blocking_Is_Off()
    {
        // the username check does not need an address; only same-IP matching does
        Assert.False(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: false, blockedUsernames: 5, knownBlockedIps: 3, ipRanges: 0, places: 0, geoAvailable: true));
    }

    [Fact]
    public void A_Blocked_Range_Always_Needs_An_Address()
    {
        Assert.True(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: false, blockedUsernames: 0, knownBlockedIps: 0, ipRanges: 1, places: 0, geoAvailable: false));
    }

    [Fact]
    public void A_Blocked_Place_Needs_An_Address_Only_When_Geolocation_Is_Available()
    {
        Assert.True(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: false, blockedUsernames: 0, knownBlockedIps: 0, ipRanges: 0, places: 1, geoAvailable: true));

        // without the database an address cannot be resolved to a country, so it decides nothing
        Assert.False(BlockedUsersService.IpRulesCouldMatch(
            blockSameIp: false, blockedUsernames: 0, knownBlockedIps: 0, ipRanges: 0, places: 1, geoAvailable: false));
    }
}
