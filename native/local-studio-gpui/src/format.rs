use chrono::{DateTime, Local};

pub const NBSP: char = '\u{00a0}';
pub const UNKNOWN: &str = "\u{2014}";

const GB: f64 = 1e9;

fn group(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn fixed(value: f64, decimals: usize) -> String {
    if !value.is_finite() {
        return UNKNOWN.to_string();
    }
    let text = format!("{:.*}", decimals, value.abs());
    let sign = if value < 0. && text.chars().any(|c| c.is_ascii_digit() && c != '0') {
        "-"
    } else {
        ""
    };
    match text.split_once('.') {
        Some((whole, fraction)) => format!("{sign}{}.{fraction}", group(whole)),
        None => format!("{sign}{}", group(&text)),
    }
}

fn gb(bytes: u64) -> String {
    let value = bytes as f64 / GB;
    if value >= 100. {
        fixed(value, 0)
    } else {
        fixed(value, 1)
    }
}

pub fn rate(tokens_per_second: f64) -> String {
    format!("{}{NBSP}tok/s", fixed(tokens_per_second, 1))
}

pub fn millis(ms: f64) -> String {
    format!("{}{NBSP}ms", fixed(ms, 0))
}

pub fn gigabytes_used(used_bytes: u64, total_bytes: u64) -> String {
    format!("{}/{}{NBSP}GB{NBSP}used", gb(used_bytes), gb(total_bytes))
}

pub fn gigabytes_pair(used_bytes: u64, total_bytes: u64) -> String {
    format!("{}/{}{NBSP}GB", gb(used_bytes), gb(total_bytes))
}

pub fn watts_pair(draw: f64, limit: f64) -> String {
    format!("{}/{}{NBSP}W", fixed(draw, 0), fixed(limit, 0))
}

pub fn percent(fraction: f64) -> String {
    format!("{}{NBSP}%", fixed(fraction * 100., 0))
}

pub fn celsius(c: f64) -> String {
    format!("{}{NBSP}\u{00b0}C", fixed(c, 0))
}

fn trim(text: String) -> String {
    match text.strip_suffix(".0") {
        Some(whole) => whole.to_string(),
        None => text,
    }
}

pub fn compact(n: f64) -> String {
    match n.abs() {
        v if v >= 1e6 => format!("{}M", trim(fixed(n / 1e6, 1))),
        v if v >= 1e5 => format!("{}k", fixed(n / 1e3, 0)),
        v if v >= 1e3 => format!("{}k", trim(fixed(n / 1e3, 1))),
        _ => fixed(n, 0),
    }
}

pub fn clock(at: DateTime<Local>) -> String {
    at.format("%H:%M:%S").to_string()
}

pub fn gpu_label(names: &[&str]) -> String {
    let Some(first) = names.first() else {
        return String::new();
    };
    let name = first.trim_start_matches("NVIDIA ");
    if names.iter().all(|n| n == first) && names.len() > 1 {
        format!(
            "{}\u{00d7}{NBSP}{}",
            names.len(),
            name.replace(' ', &NBSP.to_string())
        )
    } else if names.len() == 1 {
        name.replace(' ', &NBSP.to_string())
    } else {
        format!("{}{NBSP}GPUs", names.len())
    }
}
