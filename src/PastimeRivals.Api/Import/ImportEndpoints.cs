using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;

namespace PastimeRivals.Api.Import;

/// <summary>
/// Key-protected bulk loader for pipeline output (decision D22: the build PC cannot reach SQL Server directly).
/// POST /api/admin/import/{table}?mode=replace|append with a CSV body and header X-Import-Key.
/// Hidden (404) unless Import:Key is configured.
/// </summary>
public static class ImportEndpoints
{
    private static readonly HashSet<string> Tables = new(StringComparer.Ordinal)
        { "batters", "pitchers", "leagues", "people", "platoon", "exposure" };

    public static void MapImport(this WebApplication app)
    {
        app.MapPost("/api/admin/import/{table}", async (string table, string? mode, HttpRequest req, IConfiguration cfg) =>
        {
            var key = cfg["Import:Key"];
            if (string.IsNullOrEmpty(key)) return Results.NotFound();
            var given = req.Headers["X-Import-Key"].ToString();
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(key)))
                return Results.Unauthorized();
            if (!Tables.Contains(table)) return Results.BadRequest("Unknown table");
            if (mode is not ("replace" or "append")) return Results.BadRequest("mode must be replace or append");

            using var body = new StreamReader(req.Body);
            DataTable data;
            try { data = CsvTable.Parse(await body.ReadToEndAsync()); }
            catch (FormatException e) { return Results.BadRequest(e.Message); }

            var cs = cfg.GetConnectionString("Stats");
            if (string.IsNullOrEmpty(cs)) return Results.Problem("No Stats connection string configured");

            var sqlTable = $"stat_{table}";
            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync();
            await using var tx = conn.BeginTransaction();
            if (mode == "replace")
            {
                var cols = string.Join(", ", data.Columns.Cast<DataColumn>().Select(c =>
                    $"[{c.ColumnName}] {(c.DataType == typeof(int) ? "INT NULL" : "NVARCHAR(100) NULL")}"));
                var ddl = $"IF OBJECT_ID('dbo.{sqlTable}') IS NOT NULL DROP TABLE dbo.{sqlTable}; CREATE TABLE dbo.{sqlTable} ({cols});";
                await using var cmd = new SqlCommand(ddl, conn, tx);
                await cmd.ExecuteNonQueryAsync();
            }
            using (var bulk = new SqlBulkCopy(conn, SqlBulkCopyOptions.Default, tx) { DestinationTableName = $"dbo.{sqlTable}", BulkCopyTimeout = 120 })
            {
                foreach (DataColumn c in data.Columns) bulk.ColumnMappings.Add(c.ColumnName, c.ColumnName);
                await bulk.WriteToServerAsync(data);
            }
            await using (var count = new SqlCommand($"SELECT COUNT(*) FROM dbo.{sqlTable}", conn, tx))
            {
                var total = (int)(await count.ExecuteScalarAsync())!;
                await tx.CommitAsync();
                return Results.Ok(new { table = sqlTable, inserted = data.Rows.Count, total });
            }
        });
    }
}
