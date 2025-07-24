use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;

fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    // 如果查找的字符串为空，则认为包含
    if needle.is_empty() {
        return true;
    }
    // 如果被查找的字符串比查找的字符串短，则不可能包含
    if haystack.len() < needle.len() {
        return false;
    }

    // 将查找字符串预先转换为小写字节序列，只做一次
    let needle_bytes: Vec<u8> = needle.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let needle_len = needle_bytes.len();

    haystack.bytes().enumerate().any(|(i, _)| {
        // 确保切片不会超出边界
        if i + needle_len > haystack.len() {
            return false;
        }
        // 获取当前位置开始的与查找字符串等长的切片
        let slice = &haystack.as_bytes()[i..i + needle_len];
        // 比较切片中的每个字节（转换为小写）是否与查找字符串的小写字节匹配
        slice.iter().zip(needle_bytes.iter()).all(|(&h_byte, &n_byte)| {
            h_byte.to_ascii_lowercase() == n_byte
        })
    })
}

/// 清理 SQL 文件，排除特定行和包含 "unistr(" 的行。
fn clean_sql_file(input_path: &Path, output_path: &Path) -> io::Result<()> {
    let file = fs::File::open(input_path)?;
    let reader = BufReader::new(file);

    let mut lines: Vec<String> = Vec::new();
    for line_result in reader.lines() {
        lines.push(line_result?);
    }

    let mut cleaned_lines: Vec<String> = Vec::new();
    let total_lines = lines.len();

    let search_term = "unistr(";

    for (idx, line) in lines.into_iter().enumerate() {
        if !contains_ignore_ascii_case(&line, search_term) && // 排除含 unistr(
           idx != 1 && // 删除第二行 (索引从0开始，所以是第二个元素)
           idx != total_lines - 1 { // 删除最后一行
            cleaned_lines.push(line);
        }
    }

    // 使用 BufWriter 提高文件写入效率
    let mut outfile = BufWriter::new(fs::File::create(output_path)?);
    for cleaned_line in cleaned_lines.iter() {
        // 写入每一行并添加换行符
        writeln!(outfile, "{}", cleaned_line)?;
    }
    // 确保所有缓冲区数据都被写入磁盘
    outfile.flush()?;

    // 打印处理结果
    println!("处理完成，输出文件：{}", output_path.display());
    println!("总行数: {}, 保留行数: {}, 删除行数: {}",
             total_lines, cleaned_lines.len(), total_lines - cleaned_lines.len());

    Ok(())
}

fn main() {
    println!("正在处理文件...");

    let input_file = Path::new("input.sql");
    let output_file = Path::new("Dict-Sqlite.sql");

    match clean_sql_file(input_file, output_file) {
        Ok(_) => {
            if let Err(e) = fs::remove_file(input_file) {
                eprintln!("错误：无法删除 input.sql 文件: {}", e);
            }
        },
        Err(e) => {
            eprintln!("文件处理失败: {}", e);
            if e.kind() == io::ErrorKind::NotFound {
                println!("未找到 input.sql 文件，请确保该文件存在于当前目录。");
            }
        }
    }

    println!("按回车键退出...");
    let mut _input = String::new();
    io::stdin().read_line(&mut _input).expect("读取输入失败");
}
