using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

public sealed record Guest(Guid Id, string Nickname);

public enum ChallengeStatus { Open, Resolved, Expired }

public sealed record Challenge(
    string Code, Guid CreatorId, string CreatorName, Guid? OpponentId, string? OpponentName,
    ChallengeStatus Status, DateTime CreatedUtc, DateTime ExpiresUtc, Guid? RematchFor, string? RematchOf,
    int[]? Totals, int? Winner, IReadOnlyList<string>? Notes = null, bool VsCpu = false, int? CpuLevel = null, int? Deco = null,
    string Mode = Rules.Classic, EraRules? Era = null, InningData? Inning = null,
    string? CreatorTeam = null, string? OpponentTeam = null, bool CreatorTyped = false, bool OpponentTyped = false);

public sealed record StoredPick(int Side, int Slot, int Rank, string PlayerId, int Year);

public sealed record ChallengeSummary(string Code, int Side, ChallengeStatus Status, string CreatorName, string? OpponentName, DateTime CreatedUtc, DateTime ExpiresUtc, bool VsCpu = false, string Mode = Rules.Classic,
    GameSteps Steps = default, bool RematchMade = false, bool RematchForYou = false, string? CreatorTeam = null, string? OpponentTeam = null);

/// <summary>Plan 69: which funnel steps a friend game has reached (ch_funnel rows).</summary>
public readonly record struct GameSteps(bool Sent = false, bool Opened = false, bool OpenedExpired = false, bool Picking = false, bool Played = false, bool Watched = false, bool Told = false);

/// <summary>Plan 69: the status line of one row in "Your games".</summary>
public static class GameStage
{
    public const string ExpiredLate = "expired_late", Expired = "expired", Result = "result", Done = "done",
        Picking = "picking", Opened = "opened", Sent = "sent", Unsent = "unsent", YouPlayed = "you_played", RematchForYou = "rematch_for_you";

    /// <summary>Null for computer games (their row is unchanged). Uses the computed status: open, no opponent, past expiry = expired.</summary>
    public static string? Of(ChallengeSummary s, DateTime nowUtc)
    {
        if (s.VsCpu) return null;
        if (s.RematchForYou) return RematchForYou;
        var status = s.Status == ChallengeStatus.Open && s.OpponentName is null && s.ExpiresUtc <= nowUtc ? ChallengeStatus.Expired : s.Status;
        if (s.Side != 0) return status == ChallengeStatus.Resolved ? YouPlayed : null;
        var f = s.Steps;
        return status switch
        {
            ChallengeStatus.Expired => f.OpenedExpired ? ExpiredLate : Expired,
            ChallengeStatus.Resolved => f.Played && !f.Watched ? Result : Done,
            _ => f.Picking ? Picking : f.Opened ? Opened : f.Sent ? Sent : Unsent,
        };
    }

    /// <summary>Rows that light up the "result waiting" badge.</summary>
    public static bool Waiting(string? stage) => stage is Result or RematchForYou;
}

public enum LockOutcome { Locked, Taken, NotFound, Expired, OwnChallenge, NotForYou }

/// <summary>Plan 29 funnel readout: one row per day the challenges were created, first challenges and rematches apart.</summary>
public sealed record FunnelDay(DateTime Day, bool Rematch, int Created, int Sent, int Opened, int OpenedExpired, int Picking, int Played, int Watched, string Mode = Rules.Classic, int Told = 0);
public sealed record FunnelReport(IReadOnlyList<FunnelDay> Days, int Spread, IReadOnlyList<(DateTime Day, int Games)> Computer, IReadOnlyList<(string Source, int Opens)> Sources,
    FeedbackSummary? Feedback = null);

/// <summary>Plan 30: one tap of feedback. Reasons are fixed keys (comma list), never free text.</summary>
public sealed record FeedbackRow(string Vote, string Where, int? Level, string? Result, string Version, string? Mode = null);
public sealed record FeedbackSummary(IReadOnlyList<(string Where, string Vote, string Result, int N)> Votes, IReadOnlyList<(string Vote, string Reason, int N)> Reasons);

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
        string opponentKeyHash, DateTime nowUtc, Func<IReadOnlyList<StoredPick>, GameResult> resolve, string? opponentTeam = null, bool opponentTyped = false);

    /// <summary>Plan 79: sets one side's team name (report swap, admin swap). typed false = a server-made name.</summary>
    Task SetTeamAsync(string code, int side, string team, bool typed);
    /// <summary>Plan 79-A1: logs a name report; false when this address already reported that side (unique code, side, ip_hash).</summary>
    Task<bool> AddNameReportAsync(string code, int side, string oldName, string reporterKind, Guid? reporterGuest, string ipHash, DateTime nowUtc);
    /// <summary>Plan 79-A1: the typed name a report logged for that side, oldest first (null if never reported).</summary>
    Task<string?> ReportedOldNameAsync(string code, int side);
    /// <summary>Plan 79-A1: puts a name (check form) on a guest's refused list until the given time.</summary>
    Task AddRefusedNameAsync(Guid guestId, string checkForm, DateTime untilUtc);
    Task<bool> IsRefusedNameAsync(Guid guestId, string checkForm, DateTime nowUtc);
    /// <summary>Plan 79-A1: every side still carrying a typed name (admin swap-all).</summary>
    Task<IReadOnlyList<(string Code, int Side)>> TypedTeamsAsync();
    /// <summary>Plan 79-A1: name reports since a time, for the funnel readout.</summary>
    Task<IReadOnlyList<(string Code, int Side, DateTime At)>> NameReportsSinceAsync(DateTime sinceUtc);

    /// <summary>Which side of which challenge a private link opens, or null.</summary>
    Task<(string Code, int Side)?> SideByKeyHashAsync(string keyHash);

    /// <summary>Games created since a time, by guest or by address; computer games and friend challenges are counted apart.</summary>
    Task<int> CreatedSinceAsync(Guid? creatorId, string? ipHash, DateTime sinceUtc, bool vsCpu = false);

    /// <summary>Deletes a small batch of computer games older than the cutoff (plan 25 retention).</summary>
    Task PurgeCpuGamesAsync(DateTime beforeUtc);
    Task<int> OpenCountAsync(Guid creatorId, DateTime nowUtc);
    /// <summary>Plan 69: newest friend games and newest computer games, taken apart, plus open rematches addressed to this guest; with funnel steps.</summary>
    Task<IReadOnlyList<ChallengeSummary>> MineAsync(Guid guestId, int friendTake, int cpuTake, DateTime nowUtc);

    /// <summary>Plan 29: records a funnel step once per friend challenge (never for computer games).
    /// notFromIp: only when the visitor's address differs from the creator's.</summary>
    Task FunnelAsync(string code, string step, string? notFromIp = null);
    Task<FunnelReport> FunnelReportAsync(DateTime sinceUtc);

    /// <summary>Plan 30: stores a vote; null when this address already sent the daily cap. Also purges rows older than 180 days.</summary>
    Task<Guid?> AddFeedbackAsync(FeedbackRow row, string ipHash, DateTime nowUtc, int dailyCap);
    /// <summary>Plan 30: adds reasons once: only while empty, within an hour, from the same address.</summary>
    Task<bool> SetFeedbackReasonsAsync(Guid id, string reasons, string ipHash, DateTime nowUtc);
}
