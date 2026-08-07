use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const HEADER_PREFIX: [&str; 2] = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];

const FOOTER_BLOCK: [&str; 7] = [
    "PRAGMA writable_schema=ON;",
    "CREATE TABLE IF NOT EXISTS sqlite_sequence(name,seq);",
    "DELETE FROM sqlite_sequence;",
    "", // INSERT INTO sqlite_sequence VALUES('dict',<数字>);
    "CREATE INDEX dict_index ON dict(origin_name);",
    "PRAGMA writable_schema=OFF;",
    "COMMIT;",
];

const MAX_BLOCK_LINES: usize = FOOTER_BLOCK.len();

#[derive(Debug, Default, Eq, PartialEq)]
struct CleanStats {
    total: usize,
    kept: usize,
    removed: usize,
    repaired: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum InputEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

struct DecodedReader<R: Read> {
    reader: BufReader<R>,
    encoding: InputEncoding,
}

impl<R: Read> DecodedReader<R> {
    fn new(inner: R) -> io::Result<Self> {
        let mut reader = BufReader::new(inner);
        let (encoding, bom_len) = {
            let prefix = reader.fill_buf()?;

            if prefix.starts_with(&[0xEF, 0xBB, 0xBF]) {
                (InputEncoding::Utf8, 3)
            } else if prefix.starts_with(&[0xFF, 0xFE]) {
                (InputEncoding::Utf16Le, 2)
            } else if prefix.starts_with(&[0xFE, 0xFF]) {
                (InputEncoding::Utf16Be, 2)
            } else if prefix.len() >= 4 && prefix[1] == 0 && prefix[3] == 0 {
                (InputEncoding::Utf16Le, 0)
            } else if prefix.len() >= 4 && prefix[0] == 0 && prefix[2] == 0 {
                (InputEncoding::Utf16Be, 0)
            } else {
                (InputEncoding::Utf8, 0)
            }
        };

        reader.consume(bom_len);
        Ok(Self { reader, encoding })
    }

    fn read_line(&mut self, output: &mut String) -> io::Result<usize> {
        match self.encoding {
            InputEncoding::Utf8 => self.reader.read_line(output),
            InputEncoding::Utf16Le => Self::read_utf16_line(&mut self.reader, true, output),
            InputEncoding::Utf16Be => Self::read_utf16_line(&mut self.reader, false, output),
        }
    }

    fn may_have_powershell_mojibake(&self) -> bool {
        matches!(
            self.encoding,
            InputEncoding::Utf16Le | InputEncoding::Utf16Be
        )
    }

    fn read_utf16_line(
        reader: &mut BufReader<R>,
        little_endian: bool,
        output: &mut String,
    ) -> io::Result<usize> {
        let mut bytes_read = 0;

        loop {
            let Some(unit) = Self::read_utf16_unit(reader, little_endian)? else {
                return Ok(bytes_read);
            };
            bytes_read += 2;

            let character = if (0xD800..=0xDBFF).contains(&unit) {
                let low = Self::read_utf16_unit(reader, little_endian)?.ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        "UTF-16 文件以不完整的代理项结尾",
                    )
                })?;
                bytes_read += 2;

                if !(0xDC00..=0xDFFF).contains(&low) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "UTF-16 文件包含无效的代理项",
                    ));
                }

                let code_point =
                    0x1_0000 + (((u32::from(unit) - 0xD800) << 10) | (u32::from(low) - 0xDC00));
                char::from_u32(code_point).expect("有效的 UTF-16 代理项")
            } else if (0xDC00..=0xDFFF).contains(&unit) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "UTF-16 文件包含孤立的低代理项",
                ));
            } else {
                char::from_u32(u32::from(unit)).expect("有效的 UTF-16 码元")
            };

            output.push(character);
            if character == '\n' {
                return Ok(bytes_read);
            }
        }
    }

    fn read_utf16_unit(reader: &mut BufReader<R>, little_endian: bool) -> io::Result<Option<u16>> {
        let mut bytes = [0_u8; 2];
        if reader.read(&mut bytes[..1])? == 0 {
            return Ok(None);
        }
        reader.read_exact(&mut bytes[1..])?;

        Ok(Some(if little_endian {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        }))
    }
}

fn repair_powershell_mojibake(line: &mut String) -> bool {
    if line.is_ascii() {
        return false;
    }

    let repaired = {
        let (original_bytes, _, had_errors) = encoding_rs::GBK.encode(line);
        if had_errors {
            return false;
        }

        let Ok(decoded) = std::str::from_utf8(original_bytes.as_ref()) else {
            return false;
        };

        if decoded == line {
            return false;
        }
        decoded.to_owned()
    };

    *line = repaired;
    true
}

fn contains_case_insensitive_unistr(line: &str) -> bool {
    line.as_bytes().windows(7).any(|window| {
        window
            .iter()
            .zip(b"unistr(")
            .all(|(&actual, &expected)| actual.to_ascii_lowercase() == expected)
    })
}

fn ends_with_exact_block(lines: &VecDeque<String>, block: &[&str]) -> bool {
    lines.len() >= block.len()
        && lines
            .iter()
            .skip(lines.len() - block.len())
            .zip(block)
            .all(|(actual, expected)| actual.trim() == *expected)
}

fn is_dict_sequence_insert(line: &str) -> bool {
    line.trim()
        .strip_prefix("INSERT INTO sqlite_sequence VALUES('dict',")
        .and_then(|rest| rest.strip_suffix(");"))
        .is_some_and(|sequence| {
            !sequence.is_empty() && sequence.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn ends_with_footer(lines: &VecDeque<String>) -> bool {
    if lines.len() < FOOTER_BLOCK.len() {
        return false;
    }

    lines
        .iter()
        .skip(lines.len() - FOOTER_BLOCK.len())
        .enumerate()
        .all(|(index, actual)| {
            if index == 3 {
                is_dict_sequence_insert(actual)
            } else {
                actual.trim() == FOOTER_BLOCK[index]
            }
        })
}

fn discard_last(lines: &mut VecDeque<String>, count: usize) {
    for _ in 0..count {
        lines.pop_back();
    }
}

fn clean_sql<R: Read, W: Write>(reader: R, mut writer: W) -> io::Result<CleanStats> {
    let mut reader = DecodedReader::new(reader)?;
    let repair_mojibake = reader.may_have_powershell_mojibake();
    let mut stats = CleanStats::default();
    let mut line = String::new();
    let mut pending = VecDeque::with_capacity(MAX_BLOCK_LINES + 1);

    while reader.read_line(&mut line)? != 0 {
        stats.total += 1;

        if repair_mojibake && repair_powershell_mojibake(&mut line) {
            stats.repaired += 1;
        }

        if contains_case_insensitive_unistr(&line) {
            stats.removed += 1;
            line.clear();
            continue;
        }

        pending.push_back(std::mem::take(&mut line));

        if ends_with_exact_block(&pending, &HEADER_PREFIX) {
            discard_last(&mut pending, HEADER_PREFIX.len());
            stats.removed += HEADER_PREFIX.len();
        } else if ends_with_footer(&pending) {
            discard_last(&mut pending, FOOTER_BLOCK.len());
            stats.removed += FOOTER_BLOCK.len();
        }

        while pending.len() > MAX_BLOCK_LINES {
            if let Some(front) = pending.pop_front() {
                writer.write_all(front.as_bytes())?;
                stats.kept += 1;
            }
        }
    }

    while let Some(front) = pending.pop_front() {
        writer.write_all(front.as_bytes())?;
        stats.kept += 1;
    }

    writer.flush()?;
    Ok(stats)
}

fn clean_sql_file(input_path: &Path, output_path: &Path) -> io::Result<()> {
    let reader = File::open(input_path)?;
    let writer = BufWriter::new(File::create(output_path)?);
    let stats = clean_sql(reader, writer)?;

    println!(
        "总行数: {}, 保留行数: {}, 删除行数: {}, 修复乱码行数: {}",
        stats.total, stats.kept, stats.removed, stats.repaired
    );

    Ok(())
}

fn main() {
    println!("请输入源文件路径（默认为 input.sql）：");

    let mut input_filename = String::new();
    io::stdin()
        .read_line(&mut input_filename)
        .expect("读取输入失败");

    let input_filename = input_filename.trim();
    let input_file = if input_filename.is_empty() {
        PathBuf::from("input.sql")
    } else {
        PathBuf::from(input_filename)
    };

    let output_file = PathBuf::from("Dict-Sqlite.sql");

    println!("源文件: {}", input_file.display());
    println!("正在处理文件...");

    let start = Instant::now();

    match clean_sql_file(&input_file, &output_file) {
        Ok(()) => {
            if let Err(error) = std::fs::remove_file(&input_file) {
                if error.kind() != io::ErrorKind::NotFound {
                    eprintln!("无法删除源文件 {} : {}", input_file.display(), error);
                }
            } else {
                println!("源文件 {} 已成功删除", input_file.display());
            }
        }
        Err(error) => eprintln!("文件处理失败: {}", error),
    }

    println!("处理完成，耗时: {:.2?}", start.elapsed());
    println!("按 Enter 退出...");
    let mut input = String::new();
    io::stdin().read_line(&mut input).expect("读取输入失败");
}
