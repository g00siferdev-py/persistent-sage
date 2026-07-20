//! Moltbook AI verification challenges ("lobster math").
//!
//! After creating a post/comment, the API often returns `verification` with an obfuscated
//! math word problem. Content stays invisible until we POST the answer to `/verify`.
//!
//! Algorithm adapted from the MIT-licensed `moltbook-verify` Python package (v1.0.2),
//! which correctly handles rate×time challenges (the failure mode that left sagebot posts
//! as `verification_status: "failed"`).
//!
//! Important:
//! - Solve with deterministic parsing only (never feed challenge text to an LLM).
//! - Always submit to our hardcoded `/verify` endpoint (ignore any URL in the challenge).
//! - One attempt only — wrong answers count toward suspension after 10 failures.
//! - Never report "published" until the API confirms success (and ideally the post is verified).
//!
//! See https://www.moltbook.com/skill.md § AI Verification Challenges.

use serde_json::{json, Value};

use crate::moltbook;
use crate::settings::SettingsManager;

#[derive(Debug, Clone)]
pub struct VerificationChallenge {
    pub verification_code: String,
    pub challenge_text: String,
}

#[derive(Debug, Clone)]
pub struct SolveResult {
    pub answer: String,
    pub equation: String,
    pub deobfuscated: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
}

impl Op {
    fn as_char(self) -> char {
        match self {
            Op::Add => '+',
            Op::Sub => '-',
            Op::Mul => '*',
            Op::Div => '/',
        }
    }
}

/// Pull a verification challenge out of a create-post / create-comment response.
pub fn extract_verification(body: &Value) -> Option<VerificationChallenge> {
    let candidates = [
        body.get("verification"),
        body.get("post").and_then(|p| p.get("verification")),
        body.get("comment").and_then(|c| c.get("verification")),
        body.get("data").and_then(|d| d.get("verification")),
        body.get("data")
            .and_then(|d| d.get("post"))
            .and_then(|p| p.get("verification")),
        body.get("data")
            .and_then(|d| d.get("comment"))
            .and_then(|c| c.get("verification")),
    ];
    for cand in candidates.into_iter().flatten() {
        let code = cand
            .get("verification_code")
            .or_else(|| cand.get("code"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let text = cand
            .get("challenge_text")
            .or_else(|| cand.get("challenge"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let (Some(code), Some(text)) = (code, text) {
            return Some(VerificationChallenge {
                verification_code: code.to_string(),
                challenge_text: text.to_string(),
            });
        }
    }
    None
}

fn verification_status_of(body: &Value) -> Option<String> {
    body.get("verification_status")
        .or_else(|| body.get("post").and_then(|p| p.get("verification_status")))
        .or_else(|| body.get("comment").and_then(|c| c.get("verification_status")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase())
}

fn is_pending(body: &Value) -> bool {
    verification_status_of(body)
        .map(|t| t == "pending")
        .unwrap_or(false)
        || body
            .get("verification_required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
}

fn number_words() -> &'static [(&'static str, f64)] {
    &[
        ("zero", 0.0),
        ("one", 1.0),
        ("two", 2.0),
        ("three", 3.0),
        ("four", 4.0),
        ("five", 5.0),
        ("six", 6.0),
        ("seven", 7.0),
        ("eight", 8.0),
        ("nine", 9.0),
        ("ten", 10.0),
        ("eleven", 11.0),
        ("twelve", 12.0),
        ("thirteen", 13.0),
        ("fourteen", 14.0),
        ("fifteen", 15.0),
        ("sixteen", 16.0),
        ("seventeen", 17.0),
        ("eighteen", 18.0),
        ("nineteen", 19.0),
        ("twenty", 20.0),
        ("thirty", 30.0),
        ("forty", 40.0),
        ("fifty", 50.0),
        ("sixty", 60.0),
        ("seventy", 70.0),
        ("eighty", 80.0),
        ("ninety", 90.0),
        ("hundred", 100.0),
        ("thousand", 1000.0),
    ]
}

fn word_corrections(w: &str) -> String {
    match w {
        "thre" => "three",
        "fourten" => "fourteen",
        "fiften" => "fifteen",
        "sixten" => "sixteen",
        "seventen" => "seventeen",
        "eighten" => "eighteen",
        "nineten" => "nineteen",
        "twety" | "twnty" | "wenty" | "enty" => "twenty",
        "thrty" | "hirty" | "irty" | "thrte" => "thirty",
        "fty" => "fifty",
        "sxty" => "sixty",
        "sevnty" => "seventy",
        "eghty" | "ighty" => "eighty",
        "nnety" | "inety" => "ninety",
        "hundrd" => "hundred",
        "thousnd" => "thousand",
        "lobstr" => "lobster",
        "fife" | "fve" => "five",
        "hre" => "three",
        "hirteen" => "thirteen",
        "ourteen" => "fourteen",
        "ifteen" => "fifteen",
        "ixteen" => "sixteen",
        "ighteen" => "eighteen",
        "ineteen" => "nineteen",
        "orty" => "forty",
        "sped" => "speed",
        "gans" | "gan" => "gains",
        "twennty" | "tweny" => "twenty",
        other => other,
    }
    .to_string()
}

fn number_targets() -> &'static [&'static str] {
    &[
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
        "hundred",
        "thousand",
        "total",
        "force",
        "distance",
        "lobster",
        "newtons",
        "meters",
        "seconds",
        "minutes",
        "centimeters",
        "kilometers",
        "increases",
        "decreases",
        "accelerates",
        "decelerates",
        "molting",
        "antenna",
        "exerts",
        "velocity",
        "speed",
        "swims",
    ]
}

fn collapse_all_repeats(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if Some(c) == prev && c.is_ascii_alphabetic() {
            continue;
        }
        prev = Some(c);
        out.push(c);
    }
    out
}

/// Detect explicit digit operators in the *raw* challenge (not bare trailing `+`).
fn detect_explicit_op(raw: &str) -> Option<Op> {
    let digit_plus = regex_is_match(r"\d\s*\+\s*\d", raw);
    let digit_mul = regex_is_match(r"\d\s*[*\u{00d7}]\s*\d", raw) || raw.contains('×');
    let digit_div = regex_is_match(r"\d\s*/\s*\d", raw);
    let digit_sub = regex_is_match(r"\d\s+-\s+\d", raw);
    // Bare `*` / `×` (common in challenges) — but NOT bare `+` (often trailing garble).
    if digit_plus {
        return Some(Op::Add);
    }
    if digit_mul || raw.contains('*') || raw.contains('×') {
        return Some(Op::Mul);
    }
    if digit_div {
        return Some(Op::Div);
    }
    if digit_sub {
        return Some(Op::Sub);
    }
    None
}

fn regex_is_match(pat: &str, hay: &str) -> bool {
    regex::Regex::new(pat)
        .map(|re| re.is_match(hay))
        .unwrap_or(false)
}

/// Clean garbled text → readable English + optional explicit op from raw symbols.
pub fn deobfuscate(challenge: &str) -> (String, Option<Op>) {
    let explicit = detect_explicit_op(challenge);
    // Drop junk characters entirely (do not insert spaces) so "SlO/wS" stays "slows".
    let clean: String = challenge
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() {
                Some(c.to_ascii_lowercase())
            } else if c.is_whitespace() {
                Some(' ')
            } else {
                None
            }
        })
        .collect();
    let collapsed = collapse_all_repeats(&clean);
    let words: Vec<String> = collapsed
        .split_whitespace()
        .map(word_corrections)
        .collect();

    // Rejoin space-split number/domain fragments ("t w e n t y", "thi rty", "me ters").
    let mut rejoined: Vec<String> = Vec::new();
    let mut i = 0;
    let targets = number_targets();
    while i < words.len() {
        let mut matched = false;
        for span in (2..=5).rev() {
            if i + span > words.len() {
                continue;
            }
            let combined: String = words[i..i + span].concat();
            let corrected = word_corrections(&combined);
            if targets.contains(&combined.as_str()) || targets.contains(&corrected.as_str()) {
                rejoined.push(if targets.contains(&combined.as_str()) {
                    combined
                } else {
                    corrected
                });
                i += span;
                matched = true;
                break;
            }
        }
        if !matched {
            rejoined.push(words[i].clone());
            i += 1;
        }
    }

    (rejoined.join(" "), explicit)
}

fn lookup_number_word(w: &str) -> Option<f64> {
    let w = w.to_lowercase();
    number_words()
        .iter()
        .find(|(k, _)| *k == w)
        .map(|(_, v)| *v)
}

fn extract_numbers(raw: &str, cleaned: &str) -> Vec<f64> {
    let mut found: Vec<f64> = Vec::new();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let mut i = 0;
    while i < words.len() {
        if let Some(mut val) = lookup_number_word(words[i]) {
            if i + 1 < words.len() {
                if let Some(next_val) = lookup_number_word(words[i + 1]) {
                    if val >= 20.0 && next_val < 10.0 {
                        val += next_val;
                        i += 1;
                    } else if val >= 100.0 && next_val < 100.0 {
                        val += next_val;
                        i += 1;
                    }
                }
            }
            found.push(val);
        }
        i += 1;
    }

    // Digit literals from raw text.
    let re = regex::Regex::new(r"\b(\d+(?:\.\d+)?)\b").unwrap();
    for cap in re.captures_iter(raw) {
        if let Ok(n) = cap[1].parse::<f64>() {
            found.push(n);
        }
    }
    found
}

fn unique_preserve(nums: &[f64], keep_dupes: bool) -> Vec<f64> {
    if keep_dupes {
        return nums.iter().copied().take(2).collect();
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for &n in nums {
        let key = n.to_bits();
        if seen.insert(key) {
            out.push(n);
        }
    }
    out
}

fn apply_op(op: Op, a: f64, b: f64) -> Option<f64> {
    match op {
        Op::Add => Some(a + b),
        Op::Sub => Some(a - b),
        Op::Mul => Some(a * b),
        Op::Div if b != 0.0 => Some(a / b),
        Op::Div => None,
    }
}

fn detect_keyword_op(text: &str) -> Option<Op> {
    let t = text.to_lowercase();
    let subtract_words = [
        "slow",
        "slows",
        "reduce",
        "reduces",
        "resistance",
        "decelerate",
        "loses",
        "drops",
        "decreases",
        "minus",
        "subtract",
        "less",
        "gave away",
        "spent",
        "remaining",
        "left over",
    ];
    if t.contains("each") {
        return Some(Op::Mul);
    }
    if [
        "plus",
        "added",
        "adds",
        "more than",
        "additional",
        "gained",
        "gains",
        "gain",
        "accelerates",
        "faster",
        "increases",
        "speeds",
        "earns",
        "collects",
        "gathers",
        "receives",
    ]
    .iter()
    .any(|w| t.contains(w))
    {
        return Some(Op::Add);
    }
    if subtract_words.iter().any(|w| t.contains(w)) {
        return Some(Op::Sub);
    }
    if ["times", "multiply", "multiplied", "multiplies", "multi"]
        .iter()
        .any(|w| t.contains(w))
    {
        return Some(Op::Mul);
    }
    if ["divided", "divide", "split", "shared equally"]
        .iter()
        .any(|w| t.contains(w))
    {
        return Some(Op::Div);
    }
    None
}

fn rate_time_product(text: &str, nums: &[f64]) -> Option<f64> {
    let t = text.to_lowercase();
    let rate_words = [
        "per second",
        "per sec",
        "per minute",
        "per min",
        "per hour",
        "cm per",
        "meters per",
        "metres per",
    ];
    let has_rate = rate_words.iter().any(|w| t.contains(w));
    let has_subtract = ["slow", "slows", "loses", "minus", "subtract", "decreases"]
        .iter()
        .any(|w| t.contains(w));
    if !has_rate || has_subtract || nums.is_empty() {
        return None;
    }

    // "for five seconds" / "for 5 seconds"
    let re = regex::Regex::new(
        r"(?i)\bfor\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(seconds?|minutes?|hours?|secs?|mins?)\b",
    )
    .ok()?;
    let caps = re.captures(&t)?;
    let dur_str = caps.get(1)?.as_str();
    let time_val = dur_str
        .parse::<f64>()
        .ok()
        .or_else(|| lookup_number_word(dur_str))?;
    if time_val == 0.0 {
        return None;
    }
    Some(nums[0] * time_val)
}

/// Solve a Moltbook challenge. Returns answer + debug equation, or None if unparseable.
pub fn solve_challenge_detailed(challenge_text: &str) -> Option<SolveResult> {
    let (cleaned, explicit) = deobfuscate(challenge_text);
    let found = extract_numbers(challenge_text, &cleaned);

    let same_num = regex_is_match(r"(\d+)\s*[+\-*/\u{00d7}]\s*\1", challenge_text)
        || (explicit.is_some()
            && found.len() >= 2
            && found.iter().any(|&n| found.iter().filter(|&&x| x == n).count() >= 2));

    let nums = unique_preserve(&found, same_num);
    if nums.len() < 2 && explicit.is_none() {
        // Rate×time may still work with 1 rate + duration word.
        if let Some(product) = rate_time_product(&cleaned, &nums) {
            let answer = format!("{product:.2}");
            return Some(SolveResult {
                equation: format!("rate×time = {answer}"),
                answer,
                deobfuscated: cleaned,
            });
        }
        return None;
    }
    if nums.len() < 2 {
        return None;
    }

    let (op, result) = if let Some(op) = explicit {
        let r = apply_op(op, nums[0], nums[1])?;
        (op, r)
    } else if let Some(product) = rate_time_product(&cleaned, &nums) {
        (Op::Mul, product)
    } else if let Some(op) = detect_keyword_op(&cleaned) {
        let r = apply_op(op, nums[0], nums[1])?;
        (op, r)
    } else if ["total", "combined", "altogether", "sum", "how many"]
        .iter()
        .any(|w| cleaned.contains(w))
    {
        (Op::Add, nums.iter().sum())
    } else {
        // Last resort: do not guess — safer than wrong submit → suspension.
        return None;
    };

    let answer = format!("{result:.2}");
    let equation = format!("{} {} {} = {answer}", nums[0], op.as_char(), nums[1]);
    Some(SolveResult {
        answer,
        equation,
        deobfuscated: cleaned,
    })
}

/// Solve a Moltbook challenge. Returns answer formatted as `X.XX`, or None if unparseable.
pub fn solve_challenge(challenge_text: &str) -> Option<String> {
    solve_challenge_detailed(challenge_text).map(|r| r.answer)
}

/// Outcome of create + verify. Callers must treat anything other than `Verified` as failure.
#[derive(Debug, Clone)]
pub enum VerifyOutcome {
    /// No challenge was required (trusted agent) or already verified.
    Verified {
        detail: String,
        status: String,
    },
    /// Challenge present but we refused to guess.
    Unparseable {
        detail: String,
        challenge_text: String,
        deobfuscated: String,
    },
    /// We submitted an answer and the API rejected it (do NOT retry).
    Rejected {
        detail: String,
        equation: String,
        answer: String,
        challenge_text: String,
    },
    /// Network / API error submitting verify (do NOT retry).
    SubmitError { detail: String },
    /// Create said pending but no verification object to solve.
    MissingChallenge { detail: String },
}

impl VerifyOutcome {
    pub fn is_verified(&self) -> bool {
        matches!(self, VerifyOutcome::Verified { .. })
    }

    pub fn status_label(&self) -> &str {
        match self {
            VerifyOutcome::Verified { status, .. } => status.as_str(),
            VerifyOutcome::Unparseable { .. } => "pending",
            VerifyOutcome::Rejected { .. } => "failed",
            VerifyOutcome::SubmitError { .. } => "pending",
            VerifyOutcome::MissingChallenge { .. } => "pending",
        }
    }

    pub fn summary(&self) -> String {
        match self {
            VerifyOutcome::Verified { detail, status } => {
                format!("verification_status={status}; {detail}")
            }
            VerifyOutcome::Unparseable {
                detail,
                challenge_text,
                deobfuscated,
            } => format!(
                "verification_status=pending; {detail}; deobfuscated={deobfuscated:?}; full_challenge={challenge_text:?}"
            ),
            VerifyOutcome::Rejected {
                detail,
                equation,
                answer,
                challenge_text,
            } => format!(
                "verification_status=failed; {detail}; parsed {equation} (answer {answer}); full_challenge={challenge_text:?}"
            ),
            VerifyOutcome::SubmitError { detail } => {
                format!("verification_status=unknown; {detail}")
            }
            VerifyOutcome::MissingChallenge { detail } => {
                format!("verification_status=pending; {detail}")
            }
        }
    }
}

/// If the create response needs verification, solve and submit once.
/// Never retries a failed verify.
pub async fn complete_verification_if_needed(
    http: &reqwest::Client,
    settings: &SettingsManager,
    create_response: &Value,
) -> VerifyOutcome {
    let existing_status = verification_status_of(create_response);
    if existing_status.as_deref() == Some("verified") {
        return VerifyOutcome::Verified {
            detail: "already verified in create response".into(),
            status: "verified".into(),
        };
    }

    let Some(challenge) = extract_verification(create_response) else {
        if is_pending(create_response) {
            return VerifyOutcome::MissingChallenge {
                detail: "created but verification details missing — left pending, no guess".into(),
            };
        }
        // Trusted / admin bypass.
        return VerifyOutcome::Verified {
            detail: "no verification required".into(),
            status: existing_status.unwrap_or_else(|| "verified".into()),
        };
    };

    let Some(solved) = solve_challenge_detailed(&challenge.challenge_text) else {
        let (deob, _) = deobfuscate(&challenge.challenge_text);
        return VerifyOutcome::Unparseable {
            detail: "could not safely parse challenge (left pending, no guess)".into(),
            challenge_text: challenge.challenge_text,
            deobfuscated: deob,
        };
    };

    let body = json!({
        "verification_code": challenge.verification_code,
        "answer": solved.answer,
    });

    match moltbook::mb_post(http, settings, "/verify", &body).await {
        Ok(resp) => {
            let ok = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if ok {
                VerifyOutcome::Verified {
                    detail: format!(
                        "verified and published ({} → answer {})",
                        solved.equation, solved.answer
                    ),
                    status: "verified".into(),
                }
            } else {
                let err = resp
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("verification failed");
                VerifyOutcome::Rejected {
                    detail: format!("verification rejected ({err}); not retrying"),
                    equation: solved.equation,
                    answer: solved.answer,
                    challenge_text: challenge.challenge_text,
                }
            }
        }
        Err(e) => VerifyOutcome::SubmitError {
            detail: format!(
                "verification submit failed ({e}); parsed {} — not retrying",
                solved.equation
            ),
        },
    }
}

/// Confirm post/comment visibility by re-fetching when we have an id.
pub async fn confirm_content_verified(
    http: &reqwest::Client,
    settings: &SettingsManager,
    content_type: &str,
    content_id: &str,
) -> Option<String> {
    if content_id.is_empty() || content_id == "?" {
        return None;
    }
    let path = match content_type {
        "comment" => format!("/comments/{content_id}"),
        _ => format!("/posts/{content_id}"),
    };
    let body = moltbook::mb_get(http, settings, &path, &[]).await.ok()?;
    verification_status_of(&body)
}

#[cfg(test)]
mod tests {
    use super::{deobfuscate, extract_verification, solve_challenge, solve_challenge_detailed};
    use serde_json::json;

    #[test]
    fn solves_twenty_minus_five_example() {
        let challenge_official =
            "A] lO^bSt-Er S[wImS aT/ tW]eNn-Tyy mE^tE[rS aNd] SlO/wS bY^ fI[vE, wH-aTs] ThE/ nEw^ SpE[eD?";
        let ans = solve_challenge(challenge_official).expect("should solve");
        assert_eq!(ans, "15.00");
    }

    #[test]
    fn solves_rate_times_time_not_trailing_plus() {
        // The failure mode behind sagebot_331's invisible posts: "23 m/s for five seconds"
        // with a trailing `+` garble must multiply, not add.
        let challenge = "A] LoOoObSsS-tEr ]V eLaWcItEe^ S\\wImS[ aT tW/eN tY tHrEe ]mE tErS- PeR^ sEcOnD for fI[vE seconds +";
        let solved = solve_challenge_detailed(challenge).expect("should solve rate×time");
        assert_eq!(
            solved.answer, "115.00",
            "eq={} deob={}",
            solved.equation, solved.deobfuscated
        );
    }

    #[test]
    fn solves_claw_force_increases() {
        let challenge =
            "A] Lo^bSt-Er ClAw| F oRcE Is ThIrTy tW o NeW ToNs Um AnD InCrEaSeS By TwElVe";
        let ans = solve_challenge(challenge).expect("should solve");
        assert_eq!(ans, "44.00");
    }

    #[test]
    fn does_not_treat_bare_plus_as_add() {
        // Without rate×time or keywords, bare trailing + must not invent an answer.
        let challenge = "twenty three +";
        assert!(solve_challenge(challenge).is_none());
    }

    #[test]
    fn deobfuscates_basic() {
        let (d, _) = deobfuscate("tW]eNn-Tyy");
        assert!(d.contains("twenty") || d.contains("twen"), "got {d}");
    }

    #[test]
    fn extracts_nested_post_verification() {
        let body = json!({
            "success": true,
            "post": {
                "id": "abc",
                "verification_status": "pending",
                "verification": {
                    "verification_code": "moltbook_verify_x",
                    "challenge_text": "two plus three"
                }
            }
        });
        let v = extract_verification(&body).expect("verification");
        assert_eq!(v.verification_code, "moltbook_verify_x");
        assert_eq!(solve_challenge(&v.challenge_text).as_deref(), Some("5.00"));
    }
}
