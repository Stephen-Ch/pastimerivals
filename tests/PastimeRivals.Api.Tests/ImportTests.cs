using System.Net;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PastimeRivals.Api.Import;

namespace PastimeRivals.Api.Tests;

public class ImportEndpointTests
{
    private static HttpClient Client(string? key) => new WebApplicationFactory<Program>()
        .WithWebHostBuilder(b => { if (key != null) b.UseSetting("Import:Key", key); })
        .CreateClient();

    private static StringContent Body() => new("id,year,pa\nruthb101,1927,691\n", Encoding.UTF8, "text/csv");

    [Fact]
    public async Task Endpoint_is_hidden_when_no_key_is_configured()
    {
        var r = await Client(null).PostAsync("/api/admin/import/batters?mode=replace", Body());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Wrong_key_is_rejected()
    {
        var c = Client("right-key");
        c.DefaultRequestHeaders.Add("X-Import-Key", "wrong-key");
        var r = await c.PostAsync("/api/admin/import/batters?mode=replace", Body());
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Unknown_table_is_rejected()
    {
        var c = Client("k");
        c.DefaultRequestHeaders.Add("X-Import-Key", "k");
        var r = await c.PostAsync("/api/admin/import/users?mode=replace", Body());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }
}

public class CsvTableTests
{
    [Fact]
    public void Text_columns_are_known_names_everything_else_is_integer()
    {
        var t = CsvTable.Parse("id,year,teams,pa,grade\nruthb101,1927,NYA,691,A\n");
        Assert.Equal(typeof(string), t.Columns["id"]!.DataType);
        Assert.Equal(typeof(int), t.Columns["year"]!.DataType);
        Assert.Equal(typeof(string), t.Columns["teams"]!.DataType);
        Assert.Equal(typeof(string), t.Columns["grade"]!.DataType);
        Assert.Equal(691, t.Rows[0]["pa"]);
    }

    [Fact]
    public void Handles_quoted_names_and_empty_values()
    {
        var t = CsvTable.Parse("id,first,last,birth_year,hof\nx,\"O'Neil, Jr\",Smith,,HOF\n");
        Assert.Equal("O'Neil, Jr", t.Rows[0]["first"]);
        Assert.Equal(DBNull.Value, t.Rows[0]["birth_year"]);
    }

    [Fact]
    public void Rejects_unsafe_column_names()
    {
        Assert.Throws<FormatException>(() => CsvTable.Parse("id;drop table x,year\n1,2\n"));
    }
}
