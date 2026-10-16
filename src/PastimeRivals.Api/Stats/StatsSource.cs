using Microsoft.Data.SqlClient;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Stats;

public sealed record TeamRow(string Code, string League, string City, int FirstYear, int LastYear);

public sealed record PersonRow(string Id, string First, string Last, string Bats, string Throws, int? BirthYear, string Hof,
    int? BirthDate = null, int? Height = null, int? Weight = null)
{
    public string Name => $"{First} {Last}".Trim();
}

public sealed record StatsBundle(StatsCatalog Catalog, IReadOnlyList<PersonRow> People, IReadOnlyList<TeamRow>? Teams = null);

public interface IStatsSource
{
    Task<StatsBundle> LoadAsync();
}

/// <summary>Reads the stat_* tables written by the import endpoint.</summary>
public sealed class SqlStatsSource(IConfiguration cfg) : IStatsSource
{
    public async Task<StatsBundle> LoadAsync()
    {
        var cs = cfg.GetConnectionString("Stats") ?? throw new InvalidOperationException("No Stats connection string");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync();

        async Task<List<T>> Read<T>(string sql, Func<SqlDataReader, T> map)
        {
            var list = new List<T>();
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) list.Add(map(r));
            return list;
        }

        static int I(SqlDataReader r, string c) => r[c] is DBNull ? 0 : Convert.ToInt32(r[c]);
        static string S(SqlDataReader r, string c) => r[c] is DBNull ? "" : (string)r[c];
        static SeasonCounts Counts(SqlDataReader r) => new(I(r, "pa"), I(r, "k_known_pa"), I(r, "k"), I(r, "bb"), I(r, "hbp"),
            I(r, "single"), I(r, "double"), I(r, "triple"), I(r, "hr"));
        static PlayerRow Player(SqlDataReader r) => new(S(r, "id"), I(r, "year"), I(r, "pa_al"), I(r, "pa_nl"), I(r, "pa_fl"),
            Counts(r), S(r, "grade") is { Length: > 0 } g ? g[0] : 'B', S(r, "teams"), Has(r, "pos") ? S(r, "pos") : "");
        static bool Has(SqlDataReader r, string c) { for (var i = 0; i < r.FieldCount; i++) if (r.GetName(i) == c) return true; return false; }
        static int? N(SqlDataReader r, string c) => Has(r, c) && r[c] is not DBNull ? Convert.ToInt32(r[c]) : null;

        var leagues = await Read("SELECT * FROM dbo.stat_leagues", r => new LeagueRow(I(r, "year"), S(r, "league"), S(r, "side"), Counts(r)));
        var platoon = await Read("SELECT year, matchup, pa, pa AS k_known_pa, k, bb, hbp, single, [double], triple, hr FROM dbo.stat_platoon",
            r => new PlatoonRow(I(r, "year"), S(r, "matchup") == "same", Counts(r)));
        var batters = await Read("SELECT * FROM dbo.stat_batters WHERE pa > 0", Player);
        var pitchers = await Read("SELECT * FROM dbo.stat_pitchers WHERE pa > 0", Player);
        var exposure = await Read("SELECT * FROM dbo.stat_exposure", r =>
            new ExposureRow(S(r, "role"), S(r, "id"), I(r, "year"), I(r, "pa_same_hand"), I(r, "pa_with_hand_known")));
        var people = await Read("SELECT * FROM dbo.stat_people", r => new PersonRow(S(r, "id"), S(r, "first"), S(r, "last"),
            S(r, "bats"), S(r, "throws"), N(r, "birth_year"), S(r, "hof"), N(r, "birth_date"), N(r, "height"), N(r, "weight")));
        var teams = await Read("IF OBJECT_ID('dbo.stat_teams') IS NOT NULL SELECT * FROM dbo.stat_teams ELSE SELECT CAST(NULL AS NVARCHAR(10)) code, CAST(NULL AS NVARCHAR(10)) league, CAST(NULL AS NVARCHAR(50)) city, 0 first_year, 0 last_year WHERE 1=0",
            r => new TeamRow(S(r, "code"), S(r, "league"), S(r, "city"), I(r, "first_year"), I(r, "last_year")));
        return new StatsBundle(new StatsCatalog(leagues, platoon, batters, pitchers, exposure), people, teams);
    }
}

public interface IEventSink
{
    Task WriteAsync(string name, string session);
}

/// <summary>Stores analytics events in our own table (no third-party tracker).</summary>
public sealed class SqlEventSink(IConfiguration cfg) : IEventSink
{
    private bool _ready;

    public async Task WriteAsync(string name, string session)
    {
        var cs = cfg.GetConnectionString("Stats");
        if (string.IsNullOrEmpty(cs)) return;
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync();
        if (!_ready)
        {
            await using var ddl = new SqlCommand(
                "IF OBJECT_ID('dbo.app_events') IS NULL CREATE TABLE dbo.app_events (id BIGINT IDENTITY PRIMARY KEY, at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), name NVARCHAR(40) NOT NULL, session NVARCHAR(64) NOT NULL);", conn);
            await ddl.ExecuteNonQueryAsync();
            _ready = true;
        }
        await using var cmd = new SqlCommand("INSERT INTO dbo.app_events (name, session) VALUES (@n, @s)", conn);
        cmd.Parameters.AddWithValue("@n", name);
        cmd.Parameters.AddWithValue("@s", session);
        await cmd.ExecuteNonQueryAsync();
    }
}
