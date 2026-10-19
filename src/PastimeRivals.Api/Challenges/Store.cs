namespace PastimeRivals.Api.Challenges;

public sealed record Guest(Guid Id, string Nickname);

public enum ChallengeStatus { Open, Resolved, Expired }

public sealed record Challenge(
    string Code, Guid CreatorId, string CreatorName, Guid? OpponentId, string? OpponentName,
    ChallengeStatus Status, DateTime CreatedUtc, DateTime ExpiresUtc, Guid? RematchFor, string? RematchOf,
    int[]? Totals, int? Winner, IReadOnlyList<string>? Notes = null, bool VsCpu = false, int? CpuLevel = null);

public sealed record StoredPick(int Side, int Slot, int Rank, string PlayerId, int Year);

public sealed record ChallengeSummary(string Code, int Side, ChallengeStatus Status, string CreatorName, string? OpponentName, DateTime CreatedUtc, DateTime ExpiresUtc, bool VsCpu = false);

public enum LockOutcome { Locked, Taken, NotFound, Expired, OwnChallenge, NotForYou }

/// <summary>Plan 29 funnel readout: one row per day the challenges were created, first challenges and rematches apart.</summary>
public sealed record FunnelDay(DateTime Day, bool Rematch, int Created, int Sent, int Opened, int OpenedExpired, int Picking, int Played, int Watched);
public sealed record FunnelReport(IReadOnlyList<FunnelDay> Days, int Spread, IReadOnlyList<(DateTime Day, int Games)> Computer, IReadOnlyList<(string Source, int Opens)> Sources);

/// <summary>Everything challenges keep. SqlChallengeStore in production; tests use an in-memory copy.</summary>
public interface IChallengeStore
{
    Task<Guest?> GuestByTokenHashAsync(string tokenHash);
    Task<Guest> CreateGuestAsync(string tokenHash, string nickname, string ipHash);
    Task<int> GuestsCreatedSinceAsync(string ipHash, DateTime sinceUtc);
    Task<bool> RematchExistsAsync(string code, Guid creatorId);
    Task AddKeyAsync(string code, int side, string keyHash);
    Task SetNicknameAsync(Guid guestId, string nickname);

    Task CreateChallengeAsync(Challenge c, IReadOnlyList<StoredPick> picks, string creatorKeyHash, string ipHash);
    Task<Challenge?> GetAsync(string code);
    Task<IReadOnlyList<StoredPick>> PicksAsync(string code);
    Task<IReadOnlyList<AtBatResult>> AtBatsAsync(string code);
    Task ExpireAsync(string code);

    /// <summary>Uses the challenge's single clash check; true only the first time (atomic).</summary>
    Task<bool> TryUseClashCheckAsync(string code);

    /// <summary>
    /// Claims an open challenge for the opponent and stores their picks and the played game, all in one transaction.
    /// The resolve callback gets both sides' picks (creator first) and returns the game; it runs only if the claim wins.
    /// </summary>
    Task<LockOutcome> LockAndResolveAsync(string code, Guid opponentId, string opponentName, IReadOnlyList<StoredPick> opponentPicks,
        string opponentKeyHash, DateTime nowUtc, Func<IReadOnlyList<StoredPick>, GameResult> resolve);

    /// <summary>Which side of which challenge a private link opens, or null.</summary>
    Task<(string Code, int Side)?> SideByKeyHashAsync(string keyHash);

    /// <summary>Games created since a time, by guest or by address; computer games and friend challenges are counted apart.</summary>
    Task<int> CreatedSinceAsync(Guid? creatorId, string? ipHash, DateTime sinceUtc, bool vsCpu = false);

    /// <summary>Deletes a small batch of computer games older than the cutoff (plan 25 retention).</summary>
    Task PurgeCpuGamesAsync(DateTime beforeUtc);
    Task<int> OpenCountAsync(Guid creatorId, DateTime nowUtc);
    Task<IReadOnlyList<ChallengeSummary>> MineAsync(Guid guestId, int take);

    /// <summary>Plan 29: records a funnel step once per friend challenge (never for computer games).
    /// notFromIp: only when the visitor's address differs from the creator's.</summary>
    Task FunnelAsync(string code, string step, string? notFromIp = null);
    Task<FunnelReport> FunnelReportAsync(DateTime sinceUtc);
}
