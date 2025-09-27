use std::fs::File;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

// 高效地判断是否包含 "unistr("
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
    let mut writer = BufWriter::new(File::create(output_path)?);

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
    println!("请输入源文件路径（默认为 input.sql）：");

    let mut input_filename = String::new();
    io::stdin().read_line(&mut input_filename).expect("读取输入失败");
    let input_filename = input_filename.trim();

    // 确定输入文件路径，如果用户输入为空，则使用默认值
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
        Ok(_) => {
            if let Err(e) = std::fs::remove_file(&input_file) {
                if e.kind() == io::ErrorKind::NotFound {
                    eprintln!("注意：源文件 {} 不存在，无法删除", input_file.display());
                } else {
                    eprintln!("无法删除源文件 {} : {}", input_file.display(), e);
                }
            } else {
                 println!("源文件 {} 已成功删除", input_file.display());
            }
        },
        Err(e) => eprintln!("文件处理失败: {}", e),
    }

    println!("处理完成，耗时: {:.2?}", start.elapsed());
    println!("按 Enter 退出...");
    let mut _input = String::new();
    io::stdin().read_line(&mut _input).expect("读取输入失败");
}
