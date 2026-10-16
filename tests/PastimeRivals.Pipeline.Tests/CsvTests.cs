using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class CsvTests
{
    [Fact]
    public void Splits_plain_fields() =>
        Assert.Equal(new[] { "a", "", "3" }, Csv.ParseLine("a,,3"));

    [Fact]
    public void Handles_quoted_fields_with_commas_and_quotes() =>
        Assert.Equal(new[] { "BS1", "St.Louis, MO", "say \"hi\"" }, Csv.ParseLine("\"BS1\",\"St.Louis, MO\",\"say \"\"hi\"\"\""));
}
