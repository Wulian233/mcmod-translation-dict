import os


def clean_sql_file(input_path, output_path):
    with open(input_path, "r", encoding="utf-8") as infile:
        lines = infile.readlines()

    # 条件过滤：排除含 unistr 的行，排除第 2 行和最后一行
    cleaned_lines = [
        line
        for idx, line in enumerate(lines)
        if "unistr(" not in line.lower()  # 排除含 unistr(
        and idx != 1  # 删除第二行（BEGIN TRANSACTION;）
        and idx != len(lines) - 1  # 删除最后一行（COMMIT;）
    ]

    with open(output_path, "w", encoding="utf-8") as outfile:
        outfile.writelines(cleaned_lines)

    print(f"处理完成，输出文件：{output_path}")
    print(
        f"总行数: {len(lines)}, 保留行数: {len(cleaned_lines)}, 删除行数: {len(lines) - len(cleaned_lines)}"
    )


print("正在处理文件...")

try:
    clean_sql_file("input.sql", "Dict-Sqlite.sql")
    os.remove("input.sql")
except FileNotFoundError:
    print("未找到 input.sql 文件，请确保该文件存在于当前目录。")

input("按回车键退出...")
