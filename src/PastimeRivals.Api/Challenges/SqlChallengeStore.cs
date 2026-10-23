using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

/// <summary>SQL Server store. Tables are created on first use (same pattern as app_events).</summary>
public sealed class SqlChallengeStore(IConfiguration cfg) : IChallengeStore
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly HashSet<string> Ready = new();

    public const string Schema = """
        IF OBJECT_ID('dbo.ch_guests') IS NULL CREATE TABLE dbo.ch_guests (
          id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, token_hash CHAR(64) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE, nickname NVARCHAR(24) NOT NULL, ip_hash CHAR(64) COLLATE Latin1_General_BIN2 NOT NULL,
          created_utc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), last_seen_utc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
        IF OBJECT_ID('dbo.ch_challenges') IS NULL CREATE TABLE dbo.ch_challenges (
          code VARCHAR(24) COLLATE Latin1_General_BIN2 NOT NULL PRIMARY KEY, creator_id UNIQUEIDENTIFIER NOT NULL, creator_name NVARCHAR(24) NOT NULL,
          opponent_id UNIQUEIDENTIFIER NULL, opponent_name NVARCHAR(24) NULL, status TINYINT NOT NULL,
          created_utc DATETIME2 NOT NULL, expires_utc DATETIME2 NOT NULL, locked_utc DATETIME2 NULL,
          rematch_for UNIQUEIDENTIFIER NULL, rematch_of VARCHAR(24) COLLATE Latin1_General_BIN2 NULL, creator_ip CHAR(64) COLLATE Latin1_General_BIN2 NOT NULL,
          seed DECIMAL(20,0) NULL, total0 INT NULL, total1 INT NULL, winner INT NULL, notes NVARCHAR(2000) NULL, clash_checks TINYINT NOT NULL DEFAULT 0);
        IF COL_LENGTH('dbo.ch_challenges', 'clash_checks') IS NULL ALTER TABLE dbo.ch_challenges ADD clash_checks TINYINT NOT NULL DEFAULT 0;
        IF COL_LENGTH('dbo.ch_challenges', 'vs_cpu') IS NULL ALTER TABLE dbo.ch_challenges ADD vs_cpu BIT NOT NULL DEFAULT 0;
        IF COL_LENGTH('dbo.ch_challenges', 'cpu_level') IS NULL ALTER TABLE dbo.ch_challenges ADD cpu_level TINYINT NULL;
        IF COL_LENGTH('dbo.ch_challenges', 'deco_version') IS NULL ALTER TABLE dbo.ch_challenges ADD deco_version TINYINT NULL;
        IF COL_LENGTH('dbo.ch_challenges', 'mode') IS NULL ALTER TABLE dbo.ch_challenges ADD mode TINYINT NULL, rules_version TINYINT NULL, dh BIT NULL, xrunner BIT NULL,
          era_season SMALLINT NULL, lineups VARCHAR(4000) NULL, line_score VARCHAR(200) NULL, innings TINYINT NULL;
        IF OBJECT_ID('dbo.ch_feedback') IS NULL CREATE TABLE dbo.ch_feedback (
          id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, at DATETIME2 NOT NULL, vote VARCHAR(4) NOT NULL, where_ VARCHAR(8) NOT NULL, level TINYINT NULL,
          result VARCHAR(4) NULL, reasons VARCHAR(64) NULL, version VARCHAR(16) NOT NULL, ip_hash CHAR(64) COLLATE Latin1_General_BIN2 NOT NULL);
        IF COL_LENGTH('dbo.ch_feedback', 'mode') IS NULL ALTER TABLE dbo.ch_feedback ADD mode VARCHAR(8) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_fb_ip') CREATE INDEX ix_fb_ip ON dbo.ch_feedback (ip_hash, at);
        IF OBJECT_ID('dbo.ch_funnel') IS NULL CREATE TABLE dbo.ch_funnel (
          code VARCHAR(24) COLLATE Latin1_General_BIN2 NOT NULL, step VARCHAR(16) NOT NULL, at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), PRIMARY KEY (code, step));
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ch_creator') CREATE INDEX ix_ch_creator ON dbo.ch_challenges (creator_id, created_utc);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ch_ip') CREATE INDEX ix_ch_ip ON dbo.ch_challenges (creator_ip, created_utc);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ch_rematch') CREATE INDEX ix_ch_rematch ON dbo.ch_challenges (rematch_of);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_guest_ip') CREATE INDEX ix_guest_ip ON dbo.ch_guests (ip_hash, created_utc);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ch_opponent') CREATE INDEX ix_ch_opponent ON dbo.ch_challenges (opponent_id, created_utc);
        IF OBJECT_ID('dbo.ch_picks') IS NULL CREATE TABLE dbo.ch_picks (
          code VARCHAR(24) COLLATE Latin1_General_BIN2 NOT NULL, side TINYINT NOT NULL, slot TINYINT NOT NULL, rank TINYINT NOT NULL,
          player_id VARCHAR(12) NOT NULL, year SMALLINT NOT NULL, PRIMARY KEY (code, side, slot, rank));
        IF OBJECT_ID('dbo.ch_atbats') IS NULL CREATE TABLE dbo.ch_atbats (
          code VARCHAR(24) COLLATE Latin1_General_BIN2 NOT NULL, idx TINYINT NOT NULL, round TINYINT NOT NULL, batting_side TINYINT NOT NULL,
          pitcher_id VARCHAR(12) NOT NULL, pitcher_year SMALLINT NOT NULL, batter_id VARCHAR(12) NOT NULL, batter_year SMALLINT NOT NULL,
          seed DECIMAL(20,0) NOT NULL, outcome VARCHAR(8) NOT NULL, points TINYINT NOT NULL, PRIMARY KEY (code, idx));
        IF COL_LENGTH('dbo.ch_atbats', 'inning') IS NULL ALTER TABLE dbo.ch_atbats ADD inning TINYINT NULL, spot TINYINT NULL, outs_before TINYINT NULL, outs_after TINYINT NULL,
          bases_before VARCHAR(40) NULL, bases_after VARCHAR(40) NULL, out_type VARCHAR(6) NULL, scored VARCHAR(80) NULL;
        IF OBJECT_ID('dbo.ch_keys') IS NULL CREATE TABLE dbo.ch_keys (
          key_hash CHAR(64) COLLATE Latin1_General_BIN2 NOT NULL PRIMARY KEY, code VARCHAR(24) COLLATE Latin1_General_BIN2 NOT NULL, side TINYINT NOT NULL);
        """;

    private async Task<SqlConnection> OpenAsync()
    {
        var cs = cfg.GetConnectionString("Stats") ?? throw new InvalidOperationException("No database connection string.");
        var conn = new SqlConnection(cs);
        await conn.OpenAsync();
        if (!Ready.Contains(cs))
        {
            await Gate.WaitAsync();
            try
            {
                if (!Ready.Contains(cs))
                {
                    await using var ddl = new SqlCommand(Schema, conn);
                    await ddl.ExecuteNonQueryAsync();
                    Ready.Add(cs);
                }
            }
            finally { Gate.Release(); }
        }
        return conn;
    }

    // Names and notes are Unicode; every other text value is plain ASCII (codes, hashes, player ids) and must be sent
    // as VARCHAR so SQL Server can use the indexes (Unicode parameters force a full scan on VARCHAR columns).
    private static readonly HashSet<string> Unicode = new() { "@n", "@no" };

    private static SqlCommand Cmd(SqlConnection c, string sql, SqlTransaction? tx = null, params (string, object?)[] ps)
    {
        var cmd = new SqlCommand(sql, c, tx);
        foreach (var (n, v) in ps)
        {
            if (v is string str)
                cmd.Parameters.Add(new SqlParameter(n, Unicode.Contains(n) ? SqlDbType.NVarChar : SqlDbType.VarChar, Unicode.Contains(n) ? 4000 : Math.Max(64, str.Length)) { Value = str });
            else cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        }
        return cmd;
    }

    public async Task<Guest?> GuestByTokenHashAsync(string tokenHash)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "UPDATE dbo.ch_guests SET last_seen_utc = SYSUTCDATETIME() OUTPUT inserted.id, inserted.nickname WHERE token_hash = @h", null, ("@h", tokenHash));
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? new Guest(r.GetGuid(0), r.GetString(1)) : null;
    }

    public async Task<Guest> CreateGuestAsync(string tokenHash, string nickname, string ipHash)
    {
        var g = new Guest(Guid.NewGuid(), nickname);
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "INSERT INTO dbo.ch_guests (id, token_hash, nickname, ip_hash) VALUES (@i, @h, @n, @ip)", null, ("@i", g.Id), ("@h", tokenHash), ("@n", nickname), ("@ip", ipHash));
        await cmd.ExecuteNonQueryAsync();
        return g;
    }

    public async Task<int> GuestsCreatedSinceAsync(string ipHash, DateTime sinceUtc)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "SELECT COUNT(*) FROM dbo.ch_guests WHERE ip_hash = @ip AND created_utc > @s", null, ("@ip", ipHash), ("@s", sinceUtc));
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    public async Task<bool> RematchExistsAsync(string code, Guid creatorId)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE rematch_of = @c AND creator_id = @g", null, ("@c", code), ("@g", creatorId));
        return (int)(await cmd.ExecuteScalarAsync())! > 0;
    }

    public async Task AddKeyAsync(string code, int side, string keyHash)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "INSERT INTO dbo.ch_keys (key_hash, code, side) VALUES (@k, @c, @s)", null, ("@k", keyHash), ("@c", code), ("@s", side));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SetNicknameAsync(Guid guestId, string nickname)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "UPDATE dbo.ch_guests SET nickname = @n WHERE id = @i", null, ("@n", nickname), ("@i", guestId));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task CreateChallengeAsync(Challenge ch, IReadOnlyList<StoredPick> picks, string creatorKeyHash, string ipHash)
    {
        await using var c = await OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
        await using (var cmd = Cmd(c, """
            INSERT INTO dbo.ch_challenges (code, creator_id, creator_name, status, created_utc, expires_utc, rematch_for, rematch_of, creator_ip, vs_cpu, cpu_level, deco_version,
              mode, dh, xrunner, era_season)
            VALUES (@c, @g, @n, 0, @cr, @ex, @rf, @ro, @ip, @cpu, @lv, @dv, @md, @dh, @xr, @es)
            """, tx, ("@md", ch.Mode == Rules.Inning ? 1 : null), ("@dh", ch.Era?.DesignatedHitter), ("@xr", ch.Era?.RunnerOnSecondInExtras), ("@es", ch.Era?.Season), ("@cpu", ch.VsCpu), ("@lv", ch.CpuLevel), ("@dv", ch.Deco), ("@c", ch.Code), ("@g", ch.CreatorId), ("@n", ch.CreatorName), ("@cr", ch.CreatedUtc), ("@ex", ch.ExpiresUtc),
            ("@rf", ch.RematchFor), ("@ro", ch.RematchOf), ("@ip", ipHash)))
            await cmd.ExecuteNonQueryAsync();
        await InsertPicks(c, tx, ch.Code, picks);
        await using (var cmd = Cmd(c, "INSERT INTO dbo.ch_keys (key_hash, code, side) VALUES (@k, @c, 0)", tx, ("@k", creatorKeyHash), ("@c", ch.Code)))
            await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
    }

    private static async Task InsertPicks(SqlConnection c, SqlTransaction tx, string code, IReadOnlyList<StoredPick> picks)
    {
        foreach (var p in picks)
        {
            await using var cmd = Cmd(c, "INSERT INTO dbo.ch_picks (code, side, slot, rank, player_id, year) VALUES (@c, @s, @sl, @r, @p, @y)", tx,
                ("@c", code), ("@s", p.Side), ("@sl", p.Slot), ("@r", p.Rank), ("@p", p.PlayerId), ("@y", p.Year));
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private const string ChallengeColumns = "code, creator_id, creator_name, opponent_id, opponent_name, status, created_utc, expires_utc, rematch_for, rematch_of, total0, total1, winner, notes, vs_cpu, cpu_level, deco_version, " +
        "mode, dh, xrunner, era_season, rules_version, lineups, line_score, innings";

    private static Challenge ReadChallenge(SqlDataReader r)
    {
        var c = ReadClassic(r);
        if (r.IsDBNull(17) || r.GetByte(17) != 1) return c;
        var era = new EraRules(r.GetBoolean(18), r.GetBoolean(19), r.GetInt16(20));
        InningData? inn = null;
        if (!r.IsDBNull(21))
            inn = new InningData(r.GetByte(21), era, JsonSerializer.Deserialize<List<List<LineupEntry>>>(r.GetString(22))!.Select(l => (IReadOnlyList<LineupEntry>)l).ToList(),
                JsonSerializer.Deserialize<int[][]>(r.GetString(23))!, r.GetByte(24));
        return c with { Mode = Rules.Inning, Era = era, Inning = inn };
    }

    private static Challenge ReadClassic(SqlDataReader r) => new(
        r.GetString(0), r.GetGuid(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetGuid(3), r.IsDBNull(4) ? null : r.GetString(4),
        (ChallengeStatus)r.GetByte(5), DateTime.SpecifyKind(r.GetDateTime(6), DateTimeKind.Utc), DateTime.SpecifyKind(r.GetDateTime(7), DateTimeKind.Utc),
        r.IsDBNull(8) ? null : r.GetGuid(8), r.IsDBNull(9) ? null : r.GetString(9),
        r.IsDBNull(10) ? null : new[] { r.GetInt32(10), r.GetInt32(11) }, r.IsDBNull(12) ? null : r.GetInt32(12),
        r.IsDBNull(13) ? null : JsonSerializer.Deserialize<List<string>>(r.GetString(13)), r.GetBoolean(14), r.IsDBNull(15) ? null : r.GetByte(15), r.IsDBNull(16) ? null : r.GetByte(16));

    public async Task<Challenge?> GetAsync(string code)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, $"SELECT {ChallengeColumns} FROM dbo.ch_challenges WHERE code = @c", null, ("@c", code));
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? ReadChallenge(r) : null;
    }

    public async Task<IReadOnlyList<StoredPick>> PicksAsync(string code)
    {
        await using var c = await OpenAsync();
        return await ReadPicks(c, null, code);
    }

    private static async Task<List<StoredPick>> ReadPicks(SqlConnection c, SqlTransaction? tx, string code)
    {
        await using var cmd = Cmd(c, "SELECT side, slot, rank, player_id, year FROM dbo.ch_picks WHERE code = @c ORDER BY side, slot, rank", tx, ("@c", code));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<StoredPick>();
        while (await r.ReadAsync()) list.Add(new StoredPick(r.GetByte(0), r.GetByte(1), r.GetByte(2), r.GetString(3), r.GetInt16(4)));
        return list;
    }

    public async Task<IReadOnlyList<AtBatResult>> AtBatsAsync(string code)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "SELECT idx, round, batting_side, pitcher_id, pitcher_year, batter_id, batter_year, seed, outcome, points, " +
            "inning, spot, outs_before, outs_after, bases_before, bases_after, out_type, scored FROM dbo.ch_atbats WHERE code = @c ORDER BY idx", null, ("@c", code));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<AtBatResult>();
        while (await r.ReadAsync())
            list.Add(new AtBatResult(r.GetByte(0), r.GetByte(1), r.GetByte(2), new PickRef(r.GetString(3), r.GetInt16(4)), new PickRef(r.GetString(5), r.GetInt16(6)),
                (ulong)r.GetDecimal(7), Enum.Parse<Outcome>(r.GetString(8)), r.GetByte(9),
                r.IsDBNull(10) ? null : new InningAtBat(r.GetByte(10), r.GetByte(11), r.GetByte(12), r.GetByte(13), Unbases(r.GetString(14)), Unbases(r.GetString(15)),
                    Enum.Parse<OutType>(r.GetString(16)), r.GetString(17).Split(',', StringSplitOptions.RemoveEmptyEntries))));
        return list;
    }

    /// <summary>Plan 38: bases as "first,second,third" with empty for no runner.</summary>
    internal static string Bases(string?[] b) => string.Join(",", b.Select(x => x ?? ""));
    internal static string?[] Unbases(string s) => s.Split(',').Select(x => x.Length == 0 ? null : x).ToArray();

    public async Task<bool> TryUseClashCheckAsync(string code)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "UPDATE dbo.ch_challenges SET clash_checks = clash_checks + 1 WHERE code = @c AND clash_checks = 0 AND status = 0 AND opponent_id IS NULL", null, ("@c", code));
        return await cmd.ExecuteNonQueryAsync() == 1;
    }

    public async Task ExpireAsync(string code)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "UPDATE dbo.ch_challenges SET status = 2 WHERE code = @c AND status = 0", null, ("@c", code));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<LockOutcome> LockAndResolveAsync(string code, Guid opponentId, string opponentName, IReadOnlyList<StoredPick> opponentPicks,
        string opponentKeyHash, DateTime nowUtc, Func<IReadOnlyList<StoredPick>, GameResult> resolve)
    {
        await using var c = await OpenAsync();
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        // The claim: only one opponent can turn opponent_id from NULL to themselves.
        int claimed;
        await using (var cmd = Cmd(c, """
            UPDATE dbo.ch_challenges SET opponent_id = @g, opponent_name = @n, locked_utc = @now
            WHERE code = @c AND status = 0 AND opponent_id IS NULL AND expires_utc > @now AND creator_id <> @g
              AND (rematch_for IS NULL OR rematch_for = @g)
            """, tx, ("@g", opponentId), ("@n", opponentName), ("@now", nowUtc), ("@c", code)))
            claimed = await cmd.ExecuteNonQueryAsync();
        if (claimed == 0)
        {
            await tx.RollbackAsync();
            var ch = await GetAsync(code);
            if (ch is null) return LockOutcome.NotFound;
            if (ch.CreatorId == opponentId) return LockOutcome.OwnChallenge;
            if (ch.RematchFor is { } rf && rf != opponentId) return LockOutcome.NotForYou;
            if (ch.Status == ChallengeStatus.Expired || (ch.Status == ChallengeStatus.Open && ch.OpponentId is null && ch.ExpiresUtc <= nowUtc)) return LockOutcome.Expired;
            return LockOutcome.Taken;
        }
        await InsertPicks(c, tx, code, opponentPicks);
        var all = await ReadPicks(c, tx, code);
        var game = resolve(all);
        // Chunks of 50 rows: an inning game can have 200+ at-bats and SQL Server takes at most 2100 parameters.
        for (var start = 0; start < game.AtBats.Count; start += 50)
        {
            var sql = new System.Text.StringBuilder("INSERT INTO dbo.ch_atbats (code, idx, round, batting_side, pitcher_id, pitcher_year, batter_id, batter_year, seed, outcome, points, " +
                "inning, spot, outs_before, outs_after, bases_before, bases_after, out_type, scored) VALUES ");
            var ps = new List<(string, object?)> { ("@c", code) };
            for (var i = start; i < Math.Min(start + 50, game.AtBats.Count); i++)
            {
                var a = game.AtBats[i];
                var n = a.Inn;
                sql.Append(i == start ? "" : ", ").Append($"(@c, @i{i}, @r{i}, @b{i}, @p{i}, @py{i}, @bt{i}, @by{i}, @s{i}, @o{i}, @pt{i}, @in{i}, @sp{i}, @ob{i}, @oa{i}, @bb{i}, @ba{i}, @ot{i}, @sc{i})");
                ps.AddRange(new (string, object?)[] { ($"@i{i}", a.Index), ($"@r{i}", a.Round), ($"@b{i}", a.BattingSide), ($"@p{i}", a.Pitcher.Id), ($"@py{i}", a.Pitcher.Year),
                    ($"@bt{i}", a.Batter.Id), ($"@by{i}", a.Batter.Year), ($"@s{i}", (decimal)a.Seed), ($"@o{i}", a.Outcome.ToString()), ($"@pt{i}", a.Points),
                    ($"@in{i}", n?.Inning), ($"@sp{i}", n?.Spot), ($"@ob{i}", n?.OutsBefore), ($"@oa{i}", n?.OutsAfter), ($"@bb{i}", n is null ? null : Bases(n.BasesBefore)),
                    ($"@ba{i}", n is null ? null : Bases(n.BasesAfter)), ($"@ot{i}", n?.OutType.ToString()), ($"@sc{i}", n is null ? null : string.Join(",", n.Scored)) });
            }
            await using var cmd = Cmd(c, sql.ToString(), tx, ps.ToArray());
            await cmd.ExecuteNonQueryAsync();
        }
        if (game.Inning is { } inn)
            await using (var cmd = Cmd(c, "UPDATE dbo.ch_challenges SET rules_version = @rv, lineups = @lu, line_score = @ls, innings = @ni WHERE code = @c", tx,
                ("@rv", inn.RulesVersion), ("@lu", JsonSerializer.Serialize(inn.Lineups)), ("@ls", JsonSerializer.Serialize(inn.LineScore)), ("@ni", inn.Innings), ("@c", code)))
                await cmd.ExecuteNonQueryAsync();
        await using (var cmd = Cmd(c, "UPDATE dbo.ch_challenges SET status = 1, total0 = @t0, total1 = @t1, winner = @w, notes = @no, seed = @sd WHERE code = @c", tx,
            ("@sd", (decimal)game.Seed), ("@t0", game.Totals[0]), ("@t1", game.Totals[1]), ("@w", game.Winner), ("@no", JsonSerializer.Serialize(game.Notes)), ("@c", code)))
            await cmd.ExecuteNonQueryAsync();
        await using (var cmd = Cmd(c, "INSERT INTO dbo.ch_keys (key_hash, code, side) VALUES (@k, @c, 1)", tx, ("@k", opponentKeyHash), ("@c", code)))
            await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
        return LockOutcome.Locked;
    }

    public async Task<(string Code, int Side)?> SideByKeyHashAsync(string keyHash)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "SELECT code, side FROM dbo.ch_keys WHERE key_hash = @k", null, ("@k", keyHash));
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? (r.GetString(0), r.GetByte(1)) : null;
    }

    public async Task<int> CreatedSinceAsync(Guid? creatorId, string? ipHash, DateTime sinceUtc, bool vsCpu = false)
    {
        await using var c = await OpenAsync();
        await using var cmd = creatorId is { } g
            ? Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE creator_id = @g AND created_utc > @s AND vs_cpu = @cpu", null, ("@g", g), ("@s", sinceUtc), ("@cpu", vsCpu))
            : Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE creator_ip = @ip AND created_utc > @s AND vs_cpu = @cpu", null, ("@ip", ipHash), ("@s", sinceUtc), ("@cpu", vsCpu));
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    public async Task PurgeCpuGamesAsync(DateTime beforeUtc)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, """
            DECLARE @gone TABLE (code VARCHAR(24) COLLATE Latin1_General_BIN2);
            DELETE TOP (50) FROM dbo.ch_challenges OUTPUT deleted.code INTO @gone WHERE vs_cpu = 1 AND created_utc < @b;
            DELETE FROM dbo.ch_atbats WHERE code IN (SELECT code FROM @gone);
            DELETE FROM dbo.ch_picks WHERE code IN (SELECT code FROM @gone);
            DELETE FROM dbo.ch_keys WHERE code IN (SELECT code FROM @gone);
            """, null, ("@b", beforeUtc));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<int> OpenCountAsync(Guid creatorId, DateTime nowUtc)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE creator_id = @g AND status = 0 AND opponent_id IS NULL AND expires_utc > @n", null, ("@g", creatorId), ("@n", nowUtc));
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    public async Task<IReadOnlyList<ChallengeSummary>> MineAsync(Guid guestId, int take)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, $"""
            SELECT TOP (@t) code, CASE WHEN creator_id = @g THEN 0 ELSE 1 END, status, creator_name, opponent_name, created_utc, expires_utc, vs_cpu, ISNULL(mode, 0)
            FROM dbo.ch_challenges WHERE creator_id = @g OR opponent_id = @g ORDER BY created_utc DESC
            """, null, ("@t", take), ("@g", guestId));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<ChallengeSummary>();
        while (await r.ReadAsync())
            list.Add(new ChallengeSummary(r.GetString(0), r.GetInt32(1), (ChallengeStatus)r.GetByte(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4),
                DateTime.SpecifyKind(r.GetDateTime(5), DateTimeKind.Utc), DateTime.SpecifyKind(r.GetDateTime(6), DateTimeKind.Utc), r.GetBoolean(7),
                r.GetByte(8) == 1 ? Rules.Inning : Rules.Classic));
        return list;
    }

    // ---- Plan 29: funnel ----
    public async Task FunnelAsync(string code, string step, string? notFromIp = null)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, """
            INSERT INTO dbo.ch_funnel (code, step)
            SELECT ch.code, @st FROM dbo.ch_challenges ch
            WHERE ch.code = @c AND ch.vs_cpu = 0 AND (@ip IS NULL OR ch.creator_ip <> @ip)
              AND NOT EXISTS (SELECT 1 FROM dbo.ch_funnel f WHERE f.code = ch.code AND f.step = @st)
            """, null, ("@c", code), ("@st", step), ("@ip", notFromIp));
        try { await cmd.ExecuteNonQueryAsync(); }
        catch (SqlException e) when (e.Number is 2627 or 2601) { /* a double tap won the race: already counted */ }
    }

    public async Task<FunnelReport> FunnelReportAsync(DateTime sinceUtc)
    {
        await using var c = await OpenAsync();
        var days = new List<FunnelDay>();
        await using (var cmd = Cmd(c, """
            SELECT CAST(ch.created_utc AS date), CASE WHEN ch.rematch_of IS NULL THEN 0 ELSE 1 END, COUNT(*),
                   SUM(ISNULL(f.sent, 0)), SUM(ISNULL(f.opened, 0)), SUM(ISNULL(f.opened_expired, 0)),
                   SUM(ISNULL(f.picking, 0)), SUM(ISNULL(f.played, 0)), SUM(ISNULL(f.watched, 0)), ISNULL(ch.mode, 0)
            FROM dbo.ch_challenges ch
            LEFT JOIN (SELECT code,
                MAX(CASE WHEN step = 'sent' THEN 1 ELSE 0 END) sent, MAX(CASE WHEN step = 'opened' THEN 1 ELSE 0 END) opened,
                MAX(CASE WHEN step = 'opened_expired' THEN 1 ELSE 0 END) opened_expired, MAX(CASE WHEN step = 'picking' THEN 1 ELSE 0 END) picking,
                MAX(CASE WHEN step = 'played' THEN 1 ELSE 0 END) played, MAX(CASE WHEN step = 'watched' THEN 1 ELSE 0 END) watched
                FROM dbo.ch_funnel GROUP BY code) f ON f.code = ch.code
            WHERE ch.vs_cpu = 0 AND ch.created_utc >= @s
            GROUP BY CAST(ch.created_utc AS date), CASE WHEN ch.rematch_of IS NULL THEN 0 ELSE 1 END, ISNULL(ch.mode, 0)
            ORDER BY 1, 2, ISNULL(ch.mode, 0)
            """, null, ("@s", sinceUtc)))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
                days.Add(new FunnelDay(r.GetDateTime(0), r.GetInt32(1) == 1, r.GetInt32(2), r.GetInt32(3), r.GetInt32(4), r.GetInt32(5), r.GetInt32(6), r.GetInt32(7), r.GetInt32(8),
                    r.GetByte(9) == 1 ? Rules.Inning : Rules.Classic));

        int spread;
        await using (var cmd = Cmd(c, """
            SELECT COUNT(DISTINCT a.opponent_id) FROM dbo.ch_challenges a
            WHERE a.vs_cpu = 0 AND a.opponent_id IS NOT NULL AND a.created_utc >= @s
              AND EXISTS (SELECT 1 FROM dbo.ch_challenges b WHERE b.vs_cpu = 0 AND b.creator_id = a.opponent_id AND b.created_utc > a.created_utc)
            """, null, ("@s", sinceUtc)))
            spread = (int)(await cmd.ExecuteScalarAsync())!;

        var cpu = new List<(DateTime, int)>();
        await using (var cmd = Cmd(c, "SELECT CAST(created_utc AS date), COUNT(*) FROM dbo.ch_challenges WHERE vs_cpu = 1 AND created_utc >= @s GROUP BY CAST(created_utc AS date) ORDER BY 1", null, ("@s", sinceUtc)))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) cpu.Add((r.GetDateTime(0), r.GetInt32(1)));

        var sources = new List<(string, int)>();
        await using (var cmd = Cmd(c, """
            IF COL_LENGTH('dbo.app_events', 'source') IS NOT NULL
              EXEC sp_executesql N'SELECT ISNULL(source, ''(none)''), COUNT(*) FROM dbo.app_events WHERE name = ''open'' AND at >= @s GROUP BY source ORDER BY 2 DESC', N'@s DATETIME2', @s = @s
            """, null, ("@s", sinceUtc)))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) sources.Add((r.GetString(0), r.GetInt32(1)));

        var votes = new List<(string, string, string, int)>();
        await using (var cmd = Cmd(c, "SELECT where_, vote, ISNULL(result, '-'), COUNT(*) FROM dbo.ch_feedback WHERE at >= @s GROUP BY where_, vote, ISNULL(result, '-') ORDER BY 1, 2, 3", null, ("@s", sinceUtc)))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) votes.Add((r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt32(3)));
        var reasons = new List<(string, string, int)>();
        await using (var cmd = Cmd(c, "SELECT vote, reasons FROM dbo.ch_feedback WHERE at >= @s AND reasons IS NOT NULL", null, ("@s", sinceUtc)))
        await using (var r = await cmd.ExecuteReaderAsync())
        {
            var tally = new Dictionary<(string, string), int>();
            while (await r.ReadAsync())
                foreach (var k in r.GetString(1).Split(',', StringSplitOptions.RemoveEmptyEntries))
                    tally[(r.GetString(0), k)] = tally.GetValueOrDefault((r.GetString(0), k)) + 1;
            reasons.AddRange(tally.OrderBy(t => t.Key.Item1).ThenByDescending(t => t.Value).Select(t => (t.Key.Item1, t.Key.Item2, t.Value)));
        }
        return new FunnelReport(days, spread, cpu, sources, new FeedbackSummary(votes, reasons));
    }

    // ---- Plan 30: feedback ----
    public async Task<Guid?> AddFeedbackAsync(FeedbackRow row, string ipHash, DateTime nowUtc, int dailyCap)
    {
        await using var c = await OpenAsync();
        await using (var purge = Cmd(c, "DELETE TOP (50) FROM dbo.ch_feedback WHERE at < @b", null, ("@b", nowUtc.AddDays(-180))))
            await purge.ExecuteNonQueryAsync();
        var id = Guid.NewGuid();
        await using var cmd = Cmd(c, """
            INSERT INTO dbo.ch_feedback (id, at, vote, where_, level, result, version, ip_hash, mode)
            SELECT @id, @at, @v, @w, @lv, @r, @ver, @ip, @md
            WHERE (SELECT COUNT(*) FROM dbo.ch_feedback WHERE ip_hash = @ip AND at > @since) < @cap
            """, null, ("@id", id), ("@at", nowUtc), ("@v", row.Vote), ("@w", row.Where), ("@lv", row.Level), ("@r", row.Result),
            ("@ver", row.Version), ("@md", row.Mode), ("@ip", ipHash), ("@since", nowUtc.AddDays(-1)), ("@cap", dailyCap));
        return await cmd.ExecuteNonQueryAsync() == 1 ? id : null;
    }

    public async Task<bool> SetFeedbackReasonsAsync(Guid id, string reasons, string ipHash, DateTime nowUtc)
    {
        await using var c = await OpenAsync();
        await using var cmd = Cmd(c, "UPDATE dbo.ch_feedback SET reasons = @rs WHERE id = @id AND reasons IS NULL AND ip_hash = @ip AND at > @after", null,
            ("@rs", reasons), ("@id", id), ("@ip", ipHash), ("@after", nowUtc.AddHours(-1)));
        return await cmd.ExecuteNonQueryAsync() == 1;
    }
}
