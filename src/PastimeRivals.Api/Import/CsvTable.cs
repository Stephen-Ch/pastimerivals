using System.Data;
using System.Text;
using System.Text.RegularExpressions;

namespace PastimeRivals.Api.Import;

/// <summary>Turns a pipeline CSV into a typed DataTable for bulk loading.</summary>
public static partial class CsvTable
{
    private static readonly HashSet<string> TextColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "id", "teams", "grade", "league", "side", "matchup", "role", "first", "last", "bats", "throws", "hof"
    };

    [GeneratedRegex("^[a-z_][a-z0-9_]*$")]
    private static partial Regex SafeName();

    public static DataTable Parse(string csv)
    {
        using var reader = new StringReader(csv);
        var header = SplitLine(reader.ReadLine() ?? throw new FormatException("Empty CSV"));
        var table = new DataTable();
        foreach (var name in header)
        {
            if (!SafeName().IsMatch(name)) throw new FormatException($"Unsafe column name: {name}");
            table.Columns.Add(name, TextColumns.Contains(name) ? typeof(string) : typeof(int));
        }
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            var f = SplitLine(line);
            var row = table.NewRow();
            for (var i = 0; i < header.Length; i++)
            {
                var v = i < f.Length ? f[i] : "";
                if (table.Columns[i].DataType == typeof(int))
                    row[i] = v.Length == 0 ? DBNull.Value : int.Parse(v);
                else
                    row[i] = v;
            }
            table.Rows.Add(row);
        }
        return table;
    }

    public static string[] SplitLine(string line)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var q = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (q)
            {
                if (c == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; } else q = false; }
                else sb.Append(c);
            }
            else if (c == '"') q = true;
            else if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); }
            else sb.Append(c);
        }
        fields.Add(sb.ToString());
        return fields.ToArray();
    }
}
