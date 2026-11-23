namespace PastimeRivals.Api.Challenges;

/// <summary>
/// Plan 79-A1 word lists, APPROVED by Stephen 2026-11-23 13:36 ("add all"). Source and reasons: Project doc
/// planning/79-A1-STEP0-WORD-LISTS.md. Exact whole words on the check form only (NameRules.CheckForm). Do not edit
/// without Stephen's yes: the must-pass sweep in Plan79NameTests reruns on every change.
/// </summary>
public static class NameWords
{
    public static readonly HashSet<string> Block = new(StringComparer.Ordinal)
    {
        "acrotomophilia", "akia", "anal", "anilingus", "anus", "apeshit", "arse", "arsehole", "arseholes", "arses", "aryan", "aryans", "ass",
        "asses", "asshole", "assholes", "assmunch", "autoerotic", "ayak", "badass", "badasses", "bareback", "barenaked", "bastard", "bastardo",
        "bastards", "bastinado", "bbw", "bdsm", "beaner", "beaners", "beastiality", "beaver", "beavers", "bestiality", "bimbos", "birdlock", "bitch",
        "bitches", "bitching", "bitchy", "blowjob", "blumpkin", "bollocks", "bondage", "boner", "boob", "boobies", "boobs", "bukkake", "bulldyke",
        "bullshit", "bunghole", "busty", "butt", "buttcheeks", "butthole", "butts", "camgirl", "camslut", "camwhore", "carpetmuncher", "chink",
        "chinks", "cialis", "circlejerk", "clit", "clitoris", "clusterfuck", "cock", "cocks", "cocksucker", "cocksuckers", "coon", "coons",
        "coprolagnia", "coprophilia", "cornhole", "cougar", "cougars", "cracker", "crackers", "creampie", "cum", "cumming", "cumshot", "cumshots",
        "cunnilingus", "cunt", "cunts", "dago", "dagos", "darkie", "darkies", "darky", "daterape", "deepthroat", "dendrophilia", "dick", "dickface",
        "dickhead", "dickheads", "dicks", "dildo", "dildos", "dingleberries", "dingleberry", "dipshit", "dipshits", "doggiestyle", "doggystyle",
        "dolcett", "domination", "dominatrix", "dommes", "douche", "douchebag", "douchebags", "douches", "dumbass", "dumbasses", "dvda", "dyke",
        "dykes", "ecchi", "ejaculation", "erotic", "erotism", "escort", "eunuch", "fag", "faggot", "faggots", "faggy", "fags", "featherwood",
        "featherwoods", "fecal", "felch", "fellatio", "feltch", "femdom", "fgrn", "figging", "fingerbang", "fingering", "fisting", "footjob",
        "frotting", "fuck", "fucked", "fucker", "fuckers", "fuckface", "fuckhead", "fuckheads", "fuckin", "fucking", "fucks", "fucktards", "fuckwit",
        "fuckwits", "fudgepacker", "futanari", "gangbang", "genitals", "goatcx", "goatse", "gokkun", "gook", "gooks", "goregasm", "gorillion",
        "grope", "gtkrwn", "guro", "handjob", "hardcore", "hate", "heil", "hentai", "hffh", "hitler", "hoe", "hoes", "homo", "homoerotic", "homos",
        "honkey", "honkies", "honky", "hooker", "hookers", "horny", "horseshit", "humping", "incest", "intercourse", "itsub", "jackass", "jackasses",
        "jailbait", "jap", "japs", "jigaboo", "jiggaboo", "jiggerboo", "jizz", "juggs", "kabark", "kigy", "kike", "kikes", "kinbaku", "kinkster",
        "kinky", "kkk", "klan", "klans", "klansman", "klansmen", "klasp", "knobbing", "livesex", "lolita", "lovemaking", "masturbate",
        "masturbating", "masturbation", "milf", "mofo", "mong", "mongs", "motherfucker", "motherfuckers", "motherfucking", "muffdiving", "nambla",
        "nawashi", "nazi", "nazis", "negro", "negros", "neonazi", "neonazis", "nigga", "niggas", "niggaz", "nigger", "niggers", "nigguh",
        "nimphomania", "nipple", "nipples", "nsfw", "nssa", "nude", "nudity", "nutten", "nympho", "nymphomania", "octopussy", "omorashi", "orgasm",
        "orgy", "orion", "paedophile", "paki", "pakis", "panties", "panty", "pecker", "peckers", "peckerwood", "peckerwoods", "pedobear",
        "pedophile", "pedophiles", "pegging", "penis", "pikey", "piss", "pissed", "pisser", "pissers", "pissing", "pisspig", "playboy", "ponyplay",
        "poof", "poon", "poontang", "poopchute", "porn", "porno", "pornography", "prick", "pricks", "pthc", "pubes", "punany", "pussies", "pussy",
        "queaf", "queef", "quim", "raghead", "ragheads", "rahowa", "rape", "raped", "rapes", "raping", "rapist", "rapists", "rectum", "retard",
        "retarded", "retards", "rimjob", "rimming", "sadism", "sambo", "sambos", "sandnigger", "santorum", "scat", "schlong", "scissoring", "semen",
        "sex", "sexcam", "sexo", "sexual", "sexuality", "sexually", "sexy", "shag", "shags", "shemale", "shibari", "shit", "shitbag", "shitbags",
        "shitblimp", "shitface", "shithead", "shitheads", "shits", "shitter", "shitters", "shitting", "shitty", "shota", "shrimping", "skank",
        "skanks", "skeet", "slanteye", "slut", "sluts", "slutty", "smartass", "smut", "snatch", "snowballing", "sodomize", "sodomy", "sonofabitch",
        "spastic", "spaz", "spic", "spics", "splooge", "spooge", "spunk", "ss", "strapon", "strappado", "suck", "sucker", "suckers", "sucks",
        "swastika", "swastikas", "swinger", "swingers", "threesome", "throating", "tit", "tits", "titties", "titty", "tkd", "topless", "tosser",
        "tossers", "towelhead", "towelheads", "trannies", "tranny", "tribadism", "tubgirl", "tushy", "twat", "twats", "twink", "twinkie", "twinkies",
        "twinks", "undressing", "upskirt", "urophilia", "vagina", "viagra", "vibrator", "vorarephilia", "voyeur", "vulva", "wank", "wanker",
        "wankers", "wanking", "wetback", "wetbacks", "whore", "whores", "wigger", "wiggers", "wop", "wops", "wp", "wpww", "xx", "xxx", "yaoi",
        "yiffy", "ywnru", "zog", "zoophilia",
    };

    /// <summary>Phrases blanked before the block check (whole check-form tokens).</summary>
    public static readonly string[] Allowed =
    {
        "black crackers", "cougars", "blue tits", "great tits", "coal tits", "moby dicks", "moby dick", "coon hounds", "coonhounds",
        "blue footed boobies", "bluefooted boobies", "homo sapiens",
    };

    /// <summary>Distinctive current MLB nicknames, joined check-form tokens (Red Sox = redsox). Exact, no plural folding.</summary>
    public static readonly HashSet<string> Mlb = new(StringComparer.Ordinal)
    {
        "yankees", "redsox", "whitesox", "dodgers", "mets", "phillies", "astros", "mariners", "padres", "rockies", "marlins", "brewers",
        "diamondbacks", "dbacks", "guardians", "orioles", "bluejays", "nationals",
    };
}
