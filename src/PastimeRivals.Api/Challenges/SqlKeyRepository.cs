using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Data.SqlClient;

namespace PastimeRivals.Api.Challenges;

/// <summary>
/// Keeps ASP.NET's signing keys in SQL so an app restart on shared hosting does not invalidate
/// anti-forgery tokens (and, later, sign-in cookies). Plan 09: "signing keys stored in SQL".
/// </summary>
public sealed class SqlKeyRepository(string connectionString) : IXmlRepository
{
    private const string Ddl = "IF OBJECT_ID('dbo.dp_keys') IS NULL CREATE TABLE dbo.dp_keys (name NVARCHAR(100) NOT NULL PRIMARY KEY, xml NVARCHAR(MAX) NOT NULL, created_utc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());";

    private SqlConnection Open()
    {
        var c = new SqlConnection(connectionString);
        c.Open();
        using var cmd = new SqlCommand(Ddl, c);
        cmd.ExecuteNonQuery();
        return c;
    }

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        using var c = Open();
        using var cmd = new SqlCommand("SELECT xml FROM dbo.dp_keys", c);
        using var r = cmd.ExecuteReader();
        var list = new List<XElement>();
        while (r.Read()) list.Add(XElement.Parse(r.GetString(0)));
        return list;
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        using var c = Open();
        using var cmd = new SqlCommand("IF NOT EXISTS (SELECT 1 FROM dbo.dp_keys WHERE name = @n) INSERT INTO dbo.dp_keys (name, xml) VALUES (@n, @x)", c);
        cmd.Parameters.AddWithValue("@n", friendlyName);
        cmd.Parameters.AddWithValue("@x", element.ToString(SaveOptions.DisableFormatting));
        cmd.ExecuteNonQuery();
    }
}
