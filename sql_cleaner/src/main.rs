use std::fs::File;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::time::Instant;

/// 高效地判断是否包含 "unistr("
fn contains_case_insensitive_unistr(line: &str) -> bool {
    line.as_bytes()
        .windows(7)
        .any(|w| w.iter()
            .zip("unistr(".as_bytes())
            .all(|(&a, &b)| a.to_ascii_lowercase() == b))
}

fn clean_sql_file(input_path: &Path, output_path: &Path) -> io::Result<()> {
    let file = File::open(input_path)?;
    let reader = BufReader::new(file);
    let writer = BufWriter::new(File::create(output_path)?);
    let mut writer = writer;

    let mut line_buf = String::new();
    let mut line_num = 0usize;
    let mut kept = 0usize;
    let mut last_line: Option<String> = None;

    let mut reader = reader;

    while reader.read_line(&mut line_buf)? != 0 {
        line_num += 1;

        if line_num == 2 || contains_case_insensitive_unistr(&line_buf) {
            line_buf.clear();
            continue;
        }

        // 将上一行写入（避免写最后一行）
        if let Some(prev_line) = last_line.take() {
            writer.write_all(prev_line.as_bytes())?;
            kept += 1;
        }

        // 当前行变为最后一行候选
        last_line = Some(line_buf.clone());
        line_buf.clear();
    }

    writer.flush()?;
    println!("总行数: {}, 保留行数: {}, 删除行数: {}", line_num, kept, line_num - kept);

    Ok(())
}

fn main() {
    println!("正在处理文件...");
    let start = Instant::now();

    let input_file = Path::new("input.sql");
    let output_file = Path::new("Dict-Sqlite.sql");

    match clean_sql_file(input_file, output_file) {
        Ok(_) => {
            if let Err(e) = std::fs::remove_file(input_file) {
                eprintln!("无法删除 input.sql 文件: {}", e);
            }
        },
        Err(e) => eprintln!("文件处理失败: {}", e),
    }

    println!("处理完成，耗时: {:.2?}", start.elapsed());
    println!("按回车键退出...");
    let mut _input = String::new();
    io::stdin().read_line(&mut _input).expect("读取输入失败");
}
