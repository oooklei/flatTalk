#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取旅居养老线路设计方案，提取线路信息并生成测试用例
"""

import sys
from pathlib import Path

try:
    from docx import Document
except ImportError:
    print("正在安装 python-docx...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'python-docx'])
    from docx import Document

try:
    from openpyxl import load_workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
except ImportError:
    print("正在安装 openpyxl...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'openpyxl'])
    from openpyxl import load_workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

def read_docx_routes(docx_path):
    """读取docx文件，提取5条旅居养老线路信息"""
    print(f"正在读取文档: {docx_path}")
    doc = Document(docx_path)
    
    # 提取所有段落文本
    all_text = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            all_text.append(text)
    
    # 解析线路信息 - 基于文档实际结构
    routes = []
    
    # 定义线路关键词
    route_patterns = [
        ('线路1', '京族滨海文化线'),
        ('线路2', '銀发爱情边境线'),
        ('线路3', '壮村民俗康养线'),
        ('线路4', '森林轻氧休闲线'),
        ('线路5', '芒街跨境体验线'),
    ]
    
    for i, (keyword, route_name) in enumerate(route_patterns):
        route = {
            'name': route_name,
            'destination': '',
            'duration': '单日行程',
            'suitable_for': '',
            'highlights': '',
            'services': ''
        }
        
        # 查找线路在文档中的位置
        route_start = -1
        for idx, text in enumerate(all_text):
            if keyword in text or route_name in text:
                route_start = idx
                break
        
        if route_start == -1:
            # 如果没找到，尝试搜索下一个线路标题之前的内容
            if i < len(route_patterns) - 1:
                next_keyword = route_patterns[i + 1][0]
                for idx, text in enumerate(all_text):
                    if next_keyword in text:
                        route_start = max(0, idx - 15)
                        break
        
        if route_start >= 0:
            # 确定线路文本范围
            next_route_start = len(all_text)
            if i < len(route_patterns) - 1:
                next_keyword = route_patterns[i + 1][0]
                for idx in range(route_start + 1, len(all_text)):
                    if next_keyword in all_text[idx] or route_patterns[i + 1][1] in all_text[idx]:
                        next_route_start = idx
                        break
            
            # 提取线路信息
            for idx in range(route_start, min(next_route_start, route_start + 20)):
                if idx >= len(all_text):
                    break
                    
                text = all_text[idx]
                
                # 核心定位
                if '核心定位' in text:
                    if idx + 1 < len(all_text):
                        route['highlights'] = all_text[idx + 1]
                
                # 适配人群
                if '适配人群' in text or '适合人群' in text:
                    if idx + 1 < len(all_text):
                        route['suitable_for'] = all_text[idx + 1]
                
                # 目的地
                if '滨海' in route_name or '京族' in route_name:
                    route['destination'] = '防城港滨海景区'
                elif '边境' in route_name or '爱情' in route_name:
                    route['destination'] = '东兴边境景区'
                elif '壮村' in route_name:
                    route['destination'] = '壮乡田园景区'
                elif '森林' in route_name:
                    route['destination'] = '十万大山森林'
                elif '跨境' in route_name or '芒街' in route_name:
                    route['destination'] = '越南芒街跨境区'
                
                # 资源嵌入清单
                if '资源嵌入清单' in text:
                    resources = []
                    for j in range(idx + 1, min(idx + 6, next_route_start)):
                        if j < len(all_text):
                            resources.append(all_text[j])
                    route['services'] = ' '.join(resources)
        
        routes.append(route)
    
    return routes, all_text

def generate_test_cases(routes):
    """为每条线路生成测试用例"""
    test_cases = []
    
    # 如果没有成功提取到线路，使用默认线路信息
    if not routes:
        print("\n警告: 未成功提取线路信息，使用默认线路模板")
        routes = [
            {
                'name': '线路一：京族滨海文化线',
                'destination': '防城港',
                'duration': '单日行程',
                'suitable_for': '60—75周岁无重大基础病活力长者',
                'highlights': '非遗滨海康养主题，京族非遗文化+滨海负氧离子疗养',
                'services': '京族独弦琴、哈节民俗、滨海负氧离子疗养、中医艾灸理疗'
            },
            {
                'name': '线路二：銀发爱情边境线',
                'destination': '东兴',
                'duration': '单日行程',
                'suitable_for': '60—75周岁自理老年夫妻、结伴旅居长者',
                'highlights': '边境风情康养主题，边境人文体验',
                'services': '东兴国门、中越界碑、双人舒缓瑜伽、石斛药膳调养'
            },
            {
                'name': '线路三：壮村民俗康养线',
                'destination': '壮乡田园',
                'duration': '单日行程',
                'suitable_for': '60—78周岁自理长者',
                'highlights': '壮乡田园康养，壮瑶药膳、田园负氧休闲',
                'services': '壮锦、竹竿舞、田园负氧疗养、壮药熏蒸理疗'
            },
            {
                'name': '线路四：森林轻氧休闲线',
                'destination': '十万大山',
                'duration': '单日行程',
                'suitable_for': '60—78周岁自理长者',
                'highlights': '森林负氧离子疗愈，适配高血压、呼吸道、睡眠亚健康长者',
                'services': '森林步道、林间茶疗、中医慢病专项调理'
            },
            {
                'name': '线路五：芒街跨境体验线',
                'destination': '越南芒街',
                'duration': '单日行程',
                'suitable_for': '60—75周岁持有有效护照签证活力长者',
                'highlights': '中越跨境人文康养，跨境体验',
                'services': '东兴口岸、芒街人文、越南草本康养'
            }
        ]
    
    test_id = 1
    for route in routes:
        # 为每条线路生成2个测试用例
        
        # 测试用例1: 线路查询
        test_cases.append({
            'test_id': f'TR-{test_id:03d}',
            'test_scenario': f'{route.get("name", "线路")}查询',
            'input_example': f'查询{route.get("destination", "")}旅居养老线路，适合{route.get("suitable_for", "老年人")}',
            'expected_output': f'scene_key=travel_route, intent=travel_route_query, decision=accept, 返回线路信息包含{route.get("name", "")}',
            'actual_result': '待测试',
            'test_type': '正向测试',
            'priority': 'P1'
        })
        
        # 测试用例2: 行程推荐
        test_cases.append({
            'test_id': f'TR-{test_id+1:03d}',
            'test_scenario': f'{route.get("name", "线路")}行程推荐',
            'input_example': f'推荐{route.get("destination", "")}{route.get("duration", "")}康养旅居行程',
            'expected_output': f'scene_key=travel_route, intent=travel_route_recommend, decision=accept, 包含{route.get("highlights", "康养服务")}',
            'actual_result': '待测试',
            'test_type': '正向测试',
            'priority': 'P1'
        })
        
        test_id += 2
    
    # 添加额外的测试用例（天气查询、可订状态等）
    extra_cases = [
        {
            'test_id': f'TR-{test_id:03d}',
            'test_scenario': '旅居线路天气查询',
            'input_example': '查询防城港滨海线路明天的天气情况',
            'expected_output': 'scene_key=travel_route, intent=travel_route_weather, decision=accept, 返回天气信息',
            'actual_result': '待测试',
            'test_type': '正向测试',
            'priority': 'P2'
        },
        {
            'test_id': f'TR-{test_id+1:03d}',
            'test_scenario': '旅居线路可订状态检查',
            'input_example': '检查京族滨海文化线本周是否可预订',
            'expected_output': 'scene_key=travel_route, intent=travel_route_availability, decision=accept, 返回可订状态',
            'actual_result': '待测试',
            'test_type': '正向测试',
            'priority': 'P2'
        }
    ]
    
    test_cases.extend(extra_cases)
    
    return test_cases

def update_excel(excel_path, test_cases):
    """更新Excel文件，在旅居路线规划sheet中追加测试用例"""
    print(f"\n正在更新Excel文件: {excel_path}")
    
    try:
        # 加载现有工作簿
        wb = load_workbook(excel_path)
        
        # 查找或创建"旅居路线规划"sheet
        sheet_name = None
        for name in wb.sheetnames:
            if '旅居' in name or 'travel' in name.lower() or '路线' in name:
                sheet_name = name
                break
        
        if not sheet_name:
            # 使用第一个sheet作为默认
            sheet_name = wb.sheetnames[0] if wb.sheetnames else 'Sheet1'
        
        ws = wb[sheet_name]
        
        # 找到最后一行
        max_row = ws.max_row
        
        # 定义样式
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        cell_alignment = Alignment(horizontal='left', vertical='top', wrap_text=True)
        
        # 追加测试用例
        start_row = max_row + 1
        for idx, case in enumerate(test_cases):
            row = start_row + idx
            
            ws.cell(row=row, column=1, value=case['test_id']).border = border
            ws.cell(row=row, column=2, value=case['test_scenario']).border = border
            ws.cell(row=row, column=3, value=case['input_example']).border = border
            ws.cell(row=row, column=4, value=case['expected_output']).border = border
            ws.cell(row=row, column=5, value=case['actual_result']).border = border
            ws.cell(row=row, column=6, value=case['test_type']).border = border
            ws.cell(row=row, column=7, value=case['priority']).border = border
            
            # 设置对齐方式
            for col in range(1, 8):
                ws.cell(row=row, column=col).alignment = cell_alignment
        
        # 保存文件
        output_path = Path(excel_path).parent / 'flatTalk-test-cases-new.xlsx'
        wb.save(output_path)
        print(f"Excel文件已保存到: {output_path}")
        print(f"新增 {len(test_cases)} 条测试用例")
        
        return len(test_cases), output_path
        
    except PermissionError as e:
        print(f"权限错误: {e}")
        print("请关闭Excel文件后重试，或保存到新文件")
        
        # 尝试保存到新文件
        wb = load_workbook(excel_path)
        sheet_name = None
        for name in wb.sheetnames:
            if '旅居' in name or 'travel' in name.lower() or '路线' in name:
                sheet_name = name
                break
        
        if not sheet_name:
            sheet_name = wb.sheetnames[0] if wb.sheetnames else 'Sheet1'
        
        ws = wb[sheet_name]
        max_row = ws.max_row
        
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        cell_alignment = Alignment(horizontal='left', vertical='top', wrap_text=True)
        
        start_row = max_row + 1
        for idx, case in enumerate(test_cases):
            row = start_row + idx
            
            ws.cell(row=row, column=1, value=case['test_id']).border = border
            ws.cell(row=row, column=2, value=case['test_scenario']).border = border
            ws.cell(row=row, column=3, value=case['input_example']).border = border
            ws.cell(row=row, column=4, value=case['expected_output']).border = border
            ws.cell(row=row, column=5, value=case['actual_result']).border = border
            ws.cell(row=row, column=6, value=case['test_type']).border = border
            ws.cell(row=row, column=7, value=case['priority']).border = border
            
            for col in range(1, 8):
                ws.cell(row=row, column=col).alignment = cell_alignment
        
        output_path = Path(excel_path).parent / 'flatTalk-test-cases-updated.xlsx'
        wb.save(output_path)
        print(f"\n已保存到新文件: {output_path}")
        print(f"新增 {len(test_cases)} 条测试用例")
        
        return len(test_cases), output_path

def main():
    # 文件路径
    docx_path = r'd:\GuiCare\flatTalk\防城港市AI养老试点5条旅居养老线路产品设计方案（大健康产业协会牵头落地版）.docx'
    excel_path = r'd:\GuiCare\flatTalk\tests\flatTalk-test-cases.xlsx'
    
    # 检查文件是否存在
    if not Path(docx_path).exists():
        print(f"错误: 文件不存在 - {docx_path}")
        return
    
    if not Path(excel_path).exists():
        print(f"错误: 文件不存在 - {excel_path}")
        return
    
    # 读取docx文件
    routes, all_text = read_docx_routes(docx_path)
    
    print(f"\n=== 提取到的线路信息 ===")
    for i, route in enumerate(routes, 1):
        print(f"\n线路 {i}: {route.get('name', '未命名')}")
        print(f"  目的地: {route.get('destination', '未指定')}")
        print(f"  适合人群: {route.get('suitable_for', '未指定')}")
        print(f"  行程亮点: {route.get('highlights', '未指定')}")
        print(f"  康养服务: {route.get('services', '未指定')[:50]}...")
    
    # 生成测试用例
    test_cases = generate_test_cases(routes)
    
    print(f"\n=== 生成的测试用例 ({len(test_cases)}个) ===")
    for case in test_cases:
        print(f"\n{case['test_id']}: {case['test_scenario']}")
        print(f"  输入: {case['input_example']}")
        print(f"  预期: {case['expected_output']}")
    
    # 更新Excel文件
    added_count, output_path = update_excel(excel_path, test_cases)
    
    print(f"\n✓ 任务完成!")
    print(f"  - 成功读取文档: {docx_path}")
    print(f"  - 提取线路数: {len(routes)}")
    print(f"  - 生成测试用例数: {added_count}")
    print(f"  - 输出文件: {output_path}")

if __name__ == '__main__':
    main()