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
                cmd.Parameters.Add(new SqlParameter(n, Unicode.Contains(n) ? SqlDbType.NVarChar : SqlDbType.VarChar, Unicode.Contains(n) ? 4000 : 64) { Value = str });
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
            INSERT INTO dbo.ch_challenges (code, creator_id, creator_name, status, created_utc, expires_utc, rematch_for, rematch_of, creator_ip)
            VALUES (@c, @g, @n, 0, @cr, @ex, @rf, @ro, @ip)
            """, tx, ("@c", ch.Code), ("@g", ch.CreatorId), ("@n", ch.CreatorName), ("@cr", ch.CreatedUtc), ("@ex", ch.ExpiresUtc),
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

    private const string ChallengeColumns = "code, creator_id, creator_name, opponent_id, opponent_name, status, created_utc, expires_utc, rematch_for, rematch_of, total0, total1, winner, notes";

    private static Challenge ReadChallenge(SqlDataReader r) => new(
        r.GetString(0), r.GetGuid(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetGuid(3), r.IsDBNull(4) ? null : r.GetString(4),
        (ChallengeStatus)r.GetByte(5), DateTime.SpecifyKind(r.GetDateTime(6), DateTimeKind.Utc), DateTime.SpecifyKind(r.GetDateTime(7), DateTimeKind.Utc),
        r.IsDBNull(8) ? null : r.GetGuid(8), r.IsDBNull(9) ? null : r.GetString(9),
        r.IsDBNull(10) ? null : new[] { r.GetInt32(10), r.GetInt32(11) }, r.IsDBNull(12) ? null : r.GetInt32(12),
        r.IsDBNull(13) ? null : JsonSerializer.Deserialize<List<string>>(r.GetString(13)));

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
        await using var cmd = Cmd(c, "SELECT idx, round, batting_side, pitcher_id, pitcher_year, batter_id, batter_year, seed, outcome, points FROM dbo.ch_atbats WHERE code = @c ORDER BY idx", null, ("@c", code));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<AtBatResult>();
        while (await r.ReadAsync())
            list.Add(new AtBatResult(r.GetByte(0), r.GetByte(1), r.GetByte(2), new PickRef(r.GetString(3), r.GetInt16(4)), new PickRef(r.GetString(5), r.GetInt16(6)),
                (ulong)r.GetDecimal(7), Enum.Parse<Outcome>(r.GetString(8)), r.GetByte(9)));
        return list;
    }

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
        if (game.AtBats.Count > 0)
        {
            var sql = new System.Text.StringBuilder("INSERT INTO dbo.ch_atbats (code, idx, round, batting_side, pitcher_id, pitcher_year, batter_id, batter_year, seed, outcome, points) VALUES ");
            var ps = new List<(string, object?)> { ("@c", code) };
            for (var i = 0; i < game.AtBats.Count; i++)
            {
                var a = game.AtBats[i];
                sql.Append(i == 0 ? "" : ", ").Append($"(@c, @i{i}, @r{i}, @b{i}, @p{i}, @py{i}, @bt{i}, @by{i}, @s{i}, @o{i}, @pt{i})");
                ps.AddRange(new (string, object?)[] { ($"@i{i}", a.Index), ($"@r{i}", a.Round), ($"@b{i}", a.BattingSide), ($"@p{i}", a.Pitcher.Id), ($"@py{i}", a.Pitcher.Year),
                    ($"@bt{i}", a.Batter.Id), ($"@by{i}", a.Batter.Year), ($"@s{i}", (decimal)a.Seed), ($"@o{i}", a.Outcome.ToString()), ($"@pt{i}", a.Points) });
            }
            await using var cmd = Cmd(c, sql.ToString(), tx, ps.ToArray());
            await cmd.ExecuteNonQueryAsync();
        }
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

    public async Task<int> CreatedSinceAsync(Guid? creatorId, string? ipHash, DateTime sinceUtc)
    {
        await using var c = await OpenAsync();
        await using var cmd = creatorId is { } g
            ? Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE creator_id = @g AND created_utc > @s", null, ("@g", g), ("@s", sinceUtc))
            : Cmd(c, "SELECT COUNT(*) FROM dbo.ch_challenges WHERE creator_ip = @ip AND created_utc > @s", null, ("@ip", ipHash), ("@s", sinceUtc));
        return (int)(await cmd.ExecuteScalarAsync())!;
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
            SELECT TOP (@t) code, CASE WHEN creator_id = @g THEN 0 ELSE 1 END, status, creator_name, opponent_name, created_utc, expires_utc
            FROM dbo.ch_challenges WHERE creator_id = @g OR opponent_id = @g ORDER BY created_utc DESC
            """, null, ("@t", take), ("@g", guestId));
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<ChallengeSummary>();
        while (await r.ReadAsync())
            list.Add(new ChallengeSummary(r.GetString(0), r.GetInt32(1), (ChallengeStatus)r.GetByte(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4),
                DateTime.SpecifyKind(r.GetDateTime(5), DateTimeKind.Utc), DateTime.SpecifyKind(r.GetDateTime(6), DateTimeKind.Utc)));
        return list;
    }
}
