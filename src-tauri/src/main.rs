// Windows release 构建隐藏控制台终端：windows_subsystem 必须是 crate 级内层属性（#!）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    albumark_lib::run()
}
