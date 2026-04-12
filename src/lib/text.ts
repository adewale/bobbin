export const STOPWORDS = new Set([
  // Articles, prepositions, conjunctions
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  // Pronouns
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "who", "whom",
  // Common verbs and adverbs
  "get", "got", "go", "going", "come", "make", "take", "give", "keep",
  "know", "think", "see", "want", "look", "say", "said", "tell", "use",
  "find", "put", "try", "ask", "work", "seem", "feel", "leave", "call",
  "just", "also", "very", "really", "well", "still", "even", "back",
  "right", "only", "much", "now", "here", "then", "already", "actually",
  // Demonstratives, quantifiers
  "this", "that", "these", "those", "not", "no", "nor", "so", "if",
  "than", "too", "about", "above", "after", "again", "all", "any",
  "because", "before", "between", "both", "each", "few", "more", "most",
  "some", "such", "same", "other", "own", "many", "every", "into",
  "through", "over", "out", "up", "off", "down", "away",
  // Common generic words that aren't useful as topics
  "thing", "things", "something", "everything", "nothing", "anything",
  "way", "ways", "lot", "lots", "point", "kind", "sort", "part",
  "time", "times", "people", "person", "everyone", "someone", "world",
  "good", "great", "better", "best", "bad", "worse", "worst",
  "big", "small", "long", "short", "high", "low", "new", "old",
  "first", "last", "next", "different", "important", "able",
  "don", "doesn", "didn", "won", "wouldn", "couldn", "shouldn",
  "isn", "wasn", "aren", "weren", "hasn", "haven", "hadn",
  "it's", "that's", "what's", "there's", "here's", "let's",
  "one", "two", "three", "four", "five",
  "really", "probably", "maybe", "often", "always", "never",
  "hard", "easy", "true", "false", "real", "sure", "likely",
  "basically", "essentially", "simply", "certainly",
  // Question words, relative pronouns, conjunctions (4+ chars that slip through)
  "what", "when", "where", "which", "while", "whom", "whose", "whether",
  "that", "than", "then", "there", "these", "those", "this",
  "what's", "where's", "when's", "who's",
  "like", "just", "also", "only", "very", "much", "more", "most",
  "were", "been", "have", "does", "will", "would", "could", "should",
  // Common verbs that aren't domain-specific
  "used", "using", "uses", "need", "needs", "want", "wants",
  "know", "knows", "think", "thinks", "feel", "feels",
  "look", "looks", "seem", "seems", "mean", "means",
  "give", "gives", "take", "takes", "come", "comes",
  "tell", "tells", "said", "says", "done", "doing",
  "keep", "keeps", "call", "calls", "made", "making",
  "going", "coming", "getting", "trying", "working",
  "might", "must", "shall",
  // Contractions (with apostrophe)
  "don't", "doesn't", "didn't", "won't", "wouldn't", "couldn't", "shouldn't",
  "isn't", "wasn't", "aren't", "weren't", "hasn't", "haven't", "hadn't",
  "you're", "we're", "they're", "i'm", "he's", "she's",
  "you've", "we've", "they've", "i've",
  "you'll", "we'll", "they'll", "i'll", "he'll", "she'll",
  "you'd", "we'd", "they'd", "i'd", "he'd", "she'd",
  "let's", "here's", "there's", "what's", "that's", "who's",
  // Generic nouns/adjectives that don't make useful topics
  "example", "imagine", "week", "today", "yesterday", "tomorrow",
  "year", "years", "month", "months", "day", "days",
  "number", "amount", "level", "case", "fact", "idea",
  "place", "state", "area", "hand", "line", "turn",
  "order", "form", "given", "based", "sense", "result",
  "reason", "question", "answer", "problem", "issue",
  "note", "stuff", "bunch", "couple",
  "humans", "human", "users", "user",
  // More contractions and generic words found in data
  "can't", "won't", "it'll", "we'll", "they'll",
  "makes", "making", "becomes", "becoming",
  "enough", "friend", "friends", "believe", "believed",
  "create", "creates", "created", "creating",
  "build", "builds", "built", "building",
  "start", "starts", "started", "starting",
  "change", "changes", "changed", "changing",
  "move", "moves", "moved", "moving",
  "read", "reads", "write", "writes", "wrote",
  "play", "plays", "played", "playing",
  "help", "helps", "helped", "helping",
  "show", "shows", "showed", "showing",
  "turn", "turns", "turned", "turning",
  "happen", "happens", "happened", "happening",
  "understand", "understands", "understood",
  "actually", "essentially", "particularly", "especially",
  "pretty", "quite", "really", "super", "totally",
  // More generic words found in word stats/topic noise
  "without", "along", "across", "until", "since", "toward", "towards",
  "within", "among", "against", "beyond", "during", "except",
  "around", "inside", "outside", "beneath", "beside", "besides",
  "life", "world", "today", "tomorrow", "yesterday",
  "whole", "entire", "single", "double", "half",
  "less", "more", "most", "much", "many", "few", "some",
  "else", "instead", "rather", "therefore", "however",
  "modern", "simple", "complex", "obvious", "natural",
  "similar", "different", "specific", "particular", "general",
  "certain", "possible", "impossible", "necessary", "available",
  "clear", "obvious", "current", "recent", "previous",
  "large", "larger", "largest", "small", "smaller", "smallest",
  "full", "empty", "complete", "total", "entire",
  "direct", "directly", "indirect", "indirectly",
  "especially", "particularly", "specifically", "generally",
  "often", "sometimes", "usually", "rarely", "frequently",
  "simply", "merely", "slightly", "roughly", "approximately",
  // Additional noise words from word statistics analysis
  "gets", "getting", "another", "itself", "myself", "yourself", "themselves",
  "ourselves", "having", "whole", "little", "fast", "faster", "fastest",
  "easier", "easiest", "possible", "impossible",
  "once", "twice", "alongside", "despite", "versus",
  "interesting", "interestingly", "remarkable", "remarkably",
  "open", "close", "closed", "wide", "narrow",
  "powerful", "useful", "default", "thinking",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

export function stripToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
