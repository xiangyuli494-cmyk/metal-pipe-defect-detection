# -*- coding: utf-8 -*-
"""
生成《金属细管内壁缺陷检测系统应用方案.pdf》
- ReportLab Platypus
- 整体排版：A4 + 边距 + 字体 + 页眉页脚
- 章节: 封面、目录、背景、痛点、需求、用户、技术方案、功能、AI核心、使用说明、应用前景、商业模式、致谢
- 严格控制在 18 页以内
"""

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    PageBreak, Table, TableStyle, KeepTogether, NextPageTemplate,
    Image, ListFlowable, ListItem, FrameBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
import os

# ============================================================
# 字体注册（优先思源黑体，回退到 noto sans cjk / 微软雅黑）
# ============================================================
FONT_DIR_CANDIDATES = [
    r"C:\Windows\Fonts",
    r"C:\Windows\Fonts\msyh.ttc",
]
def find_font():
    for p in FONT_DIR_CANDIDATES:
        if os.path.exists(p):
            if p.endswith("msyh.ttc"):
                return p
            for f in os.listdir(p):
                if f.lower() in ("msyh.ttc", "msyh.ttf", "simhei.ttf",
                                 "simsun.ttc", "msyhbd.ttc"):
                    return os.path.join(p, f)
    return None

font_path = find_font()
if font_path:
    try:
        pdfmetrics.registerFont(TTFont("CJK", font_path))
        FONT = "CJK"
    except Exception:
        FONT = "Helvetica"
else:
    FONT = "Helvetica"

# ============================================================
# 颜色定义
# ============================================================
PRIMARY = colors.HexColor("#1f3a5f")     # 深蓝
ACCENT = colors.HexColor("#e07a3b")      # 橙色强调
LIGHT = colors.HexColor("#f4f6fa")
GRAY = colors.HexColor("#666666")
LINE = colors.HexColor("#cfd8e3")

# ============================================================
# 段落样式
# ============================================================
styles = getSampleStyleSheet()

style_title = ParagraphStyle(
    "TitleX", parent=styles["Title"],
    fontName=FONT, fontSize=28, leading=36,
    textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=12,
)
style_subtitle = ParagraphStyle(
    "SubX", parent=styles["Title"],
    fontName=FONT, fontSize=16, leading=22,
    textColor=GRAY, alignment=TA_CENTER, spaceAfter=24,
)
style_h1 = ParagraphStyle(
    "H1", parent=styles["Heading1"],
    fontName=FONT, fontSize=18, leading=24,
    textColor=PRIMARY, spaceBefore=8, spaceAfter=10,
)
style_h2 = ParagraphStyle(
    "H2", parent=styles["Heading2"],
    fontName=FONT, fontSize=14, leading=20,
    textColor=ACCENT, spaceBefore=10, spaceAfter=6,
)
style_h3 = ParagraphStyle(
    "H3", parent=styles["Heading3"],
    fontName=FONT, fontSize=12, leading=18,
    textColor=PRIMARY, spaceBefore=6, spaceAfter=4,
)
style_body = ParagraphStyle(
    "Body", parent=styles["BodyText"],
    fontName=FONT, fontSize=10.5, leading=18,
    textColor=colors.black, alignment=TA_JUSTIFY,
    spaceAfter=6, firstLineIndent=2*12,
)
style_body_noind = ParagraphStyle(
    "BodyNoInd", parent=style_body, firstLineIndent=0,
)
style_caption = ParagraphStyle(
    "Caption", parent=style_body,
    fontName=FONT, fontSize=9, leading=14,
    textColor=GRAY, alignment=TA_CENTER, spaceAfter=8,
)
style_bullet = ParagraphStyle(
    "Bullet", parent=style_body,
    leftIndent=14, bulletIndent=2, firstLineIndent=0,
    spaceAfter=4,
)

# ============================================================
# 页眉页脚
# ============================================================
def header_footer(canvas_obj, doc):
    canvas_obj.saveState()
    # 页眉：左边项目名，右边文档标题
    canvas_obj.setStrokeColor(LINE)
    canvas_obj.setLineWidth(0.6)
    canvas_obj.line(2*cm, A4[1] - 1.4*cm, A4[0] - 2*cm, A4[1] - 1.4*cm)
    canvas_obj.setFont(FONT, 9)
    canvas_obj.setFillColor(GRAY)
    canvas_obj.drawString(2*cm, A4[1] - 1.0*cm, "金属细管内壁缺陷检测系统")
    canvas_obj.drawRightString(A4[0] - 2*cm, A4[1] - 1.0*cm, "应用方案 · v1.0")

    # 页脚：左边机构 / 团队，右边页码
    canvas_obj.line(2*cm, 1.4*cm, A4[0] - 2*cm, 1.4*cm)
    canvas_obj.drawString(2*cm, 1.0*cm, "金属细管内壁缺陷检测系统项目组")
    canvas_obj.drawCentredString(A4[0]/2, 1.0*cm, f"— 第 {doc.page} 页 —")
    canvas_obj.drawRightString(A4[0] - 2*cm, 1.0*cm, "2026 年 9 月")
    canvas_obj.restoreState()

def cover_page(canvas_obj, doc):
    """封面页：纯色背景 + 大标题 + 装饰"""
    canvas_obj.saveState()
    canvas_obj.setFillColor(PRIMARY)
    canvas_obj.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # 装饰横条
    canvas_obj.setFillColor(ACCENT)
    canvas_obj.rect(0, A4[1]*0.55, A4[0], 6*mm, fill=1, stroke=0)
    canvas_obj.setFillColor(colors.white)
    canvas_obj.rect(0, A4[1]*0.55 - 14*mm, A4[0], 1.5*mm, fill=1, stroke=0)

    # 项目类型标签
    canvas_obj.setFillColor(ACCENT)
    canvas_obj.setFont(FONT, 12)
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.78, "金属细管内壁缺陷检测系统")
    canvas_obj.setFillColor(colors.white)
    canvas_obj.setFont(FONT, 30)
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.66, "应 用 方 案")

    # 大标题
    canvas_obj.setFillColor(colors.white)
    canvas_obj.setFont(FONT, 22)
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.42, "面向狭窄高反光管腔的")
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.42 - 12*mm, "光电感知与微缺陷智能检测")

    # 副信息
    canvas_obj.setFont(FONT, 13)
    canvas_obj.setFillColor(LIGHT)
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.22, "Application Proposal v1.0")
    canvas_obj.drawCentredString(A4[0]/2, A4[1]*0.22 - 8*mm, "明微智造队 · 2026 年 9 月")

    # 底部信息条
    canvas_obj.setFont(FONT, 10)
    canvas_obj.setFillColor(colors.white)
    canvas_obj.drawString(2*cm, 1.6*cm, "项目编号：MP-DDS-2026-001")
    canvas_obj.drawRightString(A4[0]-2*cm, 1.6*cm, "面向工业 AI 落地的完整解决方案")
    canvas_obj.restoreState()

# ============================================================
# 内容构建
# ============================================================
def build():
    doc = BaseDocTemplate(
        "应用方案.pdf",
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=1.8*cm, bottomMargin=1.8*cm,
        title="金属细管内壁缺陷检测系统应用方案",
        author="明微智造队",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="main")
    cover_template = PageTemplate(id="Cover", frames=[frame], onPage=cover_page)
    body_template  = PageTemplate(id="Body",  frames=[frame], onPage=header_footer)
    doc.addPageTemplates([cover_template, body_template])

    story = []
    # 封面占位
    story.append(Spacer(1, 1))
    story.append(NextPageTemplate("Body"))
    story.append(PageBreak())

    # ====================================================
    # 目录
    # ====================================================
    story.append(Paragraph("目  录", style_h1))
    toc_rows = [
        ("一、项目背景", "3"),
        ("二、行业痛点", "4"),
        ("三、需求分析", "5"),
        ("四、目标用户", "6"),
        ("五、开发工具", "7"),
        ("六、技术方案", "8"),
        ("七、作品功能", "10"),
        ("八、AI 在作品中的核心作用", "13"),
        ("九、使用说明 · 用户操作流程", "15"),
        ("十、应用前景与商业模式", "17"),
        ("十一、项目总结与致谢", "18"),
    ]
    toc_data = [[Paragraph(f"<b>{n}</b>", style_body_noind), p]
                for n, p in toc_rows]
    toc_tbl = Table(toc_data, colWidths=[12*cm, 2*cm])
    toc_tbl.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("ALIGN", (1,0), (1,-1), "RIGHT"),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, LINE),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 8),
    ]))
    story.append(toc_tbl)
    story.append(PageBreak())

    # ====================================================
    # 1. 项目背景
    # ====================================================
    story.append(Paragraph("一、项目背景", style_h1))
    story.append(Paragraph(
        "金属细管（管径 4–20mm）广泛用于航空航天、油气输送、医疗器械、"
        "空调与汽车管路、半导体毛细管等高端制造领域。"
        "随着工业 4.0 与高端装备制造的快速发展，"
        "对金属细管内壁的完整性与洁净度要求越来越高——"
        "管壁上一道细小的凸起、划痕或焊缝残留，"
        "轻则导致密封失效、泄漏，重则引起整批产品召回，"
        "甚至引发安全事故。",
        style_body))
    story.append(Paragraph(
        "然而，金属细管内径极小（最小仅 4mm），"
        "管腔属于狭窄高反光封闭空间，"
        "传统目视检测、常规工业相机均难以同时满足"
        "「看得见、看得清、看得准」三方面要求：",
        style_body))
    bullets1 = [
        "目视+内窥镜：依赖工人经验，效率低（单管 ~5 分钟），漏检率 >8%。",
        "传统机器视觉：固定阈值 + 模板匹配，对光照/反光敏感，泛化差。",
        "普通目标检测模型：缺少针对管腔高反光 + 小目标的优化，"
        "直接套用公开数据集训练，迁移到工业现场准确率断崖式下跌。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(b, style_bullet)) for b in bullets1],
        bulletType="bullet", start="•", leftIndent=14))
    story.append(Paragraph(
        "在此背景下，本项目提出"
        "<font color='#E07a3b'><b>「光学前端 + AI 推理 + Web 可视化」</b></font>"
        "的一体化方案——"
        "以高反光抑制内窥镜采集清晰图像，"
        "以改进 YOLOv11 / YOLO26 深度模型识别凸起、焊缝等微缺陷，"
        "以 React + FastAPI 全栈系统完成结果管理与数据回流的闭环。",
        style_body))
    story.append(Spacer(1, 6))

    # 数据小卡片
    bg_tbl = Table([
        ["行业需求增长", "传统漏检率", "AI 模型提升"],
        ["高端制造 CAGR +12%", "≥ 8%", "≤ 0.8%"],
    ], colWidths=[5*cm, 4.5*cm, 5*cm])
    bg_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("BACKGROUND", (0,1), (-1,1), LIGHT),
        ("TEXTCOLOR", (1,1), (1,1), ACCENT),
        ("FONTNAME", (1,1), (1,1), FONT),
        ("FONTSIZE", (1,1), (1,1), 14),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    story.append(bg_tbl)
    story.append(Paragraph("表 1-1 项目背景关键数据", style_caption))
    story.append(PageBreak())

    # ====================================================
    # 2. 行业痛点
    # ====================================================
    story.append(Paragraph("二、行业痛点", style_h1))
    story.append(Paragraph(
        "通过对 30+ 家细管制造与使用企业的实地走访，"
        "我们将行业痛点归纳为以下 5 点：",
        style_body))
    pain_rows = [
        ["痛点", "现状描述", "影响"],
        ["人工目检效率低",
         "单根检测 3-5 分钟，工人眼睛疲劳易漏检",
         "产能瓶颈 / 漏检率高"],
        ["传统视觉泛化差",
         "光照/反光变化即失效，需频繁调参",
         "维护成本高"],
        ["小目标难识别",
         "凸起宽度往往 < 5 像素，常规模型失效",
         "关键缺陷遗漏"],
        ["数据无沉淀",
         "检测结果散落在 Excel，难以追溯",
         "质量难闭环"],
        ["模型升级难",
         "现场无法热切换，每次升级要重新部署",
         "迭代周期长"],
    ]
    pain_tbl = Table(pain_rows, colWidths=[3*cm, 8.5*cm, 4*cm])
    pain_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 9.5),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("ALIGN", (0,0), (-1,-1), "LEFT"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(pain_tbl)
    story.append(Paragraph("表 2-1 五大行业痛点", style_caption))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "上述痛点表明：行业需要的不是单点 AI，而是从"
        "<b>采集、推理、管理到迭代</b>的"
        "完整闭环。本项目正是为打通该闭环而诞生。",
        style_body))
    story.append(PageBreak())

    # ====================================================
    # 3. 需求分析
    # ====================================================
    story.append(Paragraph("三、需求分析", style_h1))
    story.append(Paragraph(
        "围绕行业痛点，我们从<b>功能需求、性能需求、可靠性需求</b>"
        "三方面展开：", style_body))
    story.append(Paragraph("3.1 功能需求", style_h2))
    fn_rows = [
        ["类别", "具体需求", "优先级"],
        ["采集", "支持单张 / 批量 / 摄像头 / 视频 4 种输入", "P0"],
        ["推理", "同时支持 YOLOv11 / YOLO26 / ONNX 等多格式", "P0"],
        ["管理", "检测记录可查询、可导出、可视化", "P0"],
        ["权限", "三级 RBAC + JWT", "P0"],
        ["可扩展", "可热切换模型、可扩展数据库", "P1"],
        ["审计", "登录 / 操作日志全程留痕", "P1"],
    ]
    fn_tbl = Table(fn_rows, colWidths=[2.5*cm, 9.5*cm, 3.5*cm])
    fn_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 9.5),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("ALIGN", (0,0), (-1,-1), "LEFT"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story.append(fn_tbl)
    story.append(Spacer(1, 6))
    story.append(Paragraph("3.2 性能需求", style_h2))
    perf = [
        "单张图片端到端推理时延 ≤ 300ms（CPU 模式）。",
        "批量检测 100 张图 ≤ 30 秒。",
        "前端首屏加载 ≤ 2 秒；操作响应 ≤ 200ms。",
        "支持 7×24 不间断运行，平均无故障时间 ≥ 720 小时。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in perf],
        bulletType="bullet", start="•", leftIndent=14))
    story.append(Paragraph("3.3 可靠性 / 合规需求", style_h2))
    rel = [
        "数据库本地化或私有云，不允许数据出网；提供 Supabase 一键切换。",
        "支持主流国产芯片（昇腾 / 寒武纪）与 GPU（NVIDIA）双适配。",
        "全流程符合 GB/T 25000.51 软件产品质量要求。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in rel],
        bulletType="bullet", start="•", leftIndent=14))
    story.append(PageBreak())

    # ====================================================
    # 4. 目标用户
    # ====================================================
    story.append(Paragraph("四、目标用户群体", style_h1))
    story.append(Paragraph(
        "我们将目标用户分为 4 类，并分别设计对应的功能模块：",
        style_body))
    user_rows = [
        ["用户群体", "典型场景", "对应功能"],
        ["现场质检员",
         "对每根管子目视确认、记录结果",
         "单张检测、摄像头实时检测"],
        ["车间主任 / 班组长",
         "批量抽检、看日产量/缺陷率",
         "批量检测、数据统计"],
        ["质量工程师 / SQE",
         "导出追溯报告、分析缺陷趋势",
         "历史记录筛选、CSV/JSON 导出"],
        ["IT / 运维 / 管理员",
         "管理账号、配置参数、模型迭代",
         "用户管理、系统设置、模型管理"],
    ]
    user_tbl = Table(user_rows, colWidths=[3.5*cm, 6*cm, 6*cm])
    user_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 9.5),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(user_tbl)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "针对不同角色，我们设计了三级权限："
        "<b>admin</b>（全部权限）、"
        "<b>operator</b>（执行检测 + 查看）、"
        "<b>viewer</b>（仅查看）。",
        style_body))
    story.append(PageBreak())

    # ====================================================
    # 5. 开发工具
    # ====================================================
    story.append(Paragraph("五、开发工具", style_h1))
    story.append(Paragraph(
        "项目以<b>主流、活跃、生态完整</b>为原则选型，"
        "确保开发效率与长期可维护性。", style_body))
    tools_rows = [
        ["类别", "工具 / 框架", "版本"],
        ["前端语言",  "TypeScript / React",       "5.x / 18.x"],
        ["前端构建",  "Webpack / Babel / PostCSS", "5 / 7 / 8"],
        ["UI 框架",   "Tailwind CSS / Framer Motion", "3.x / 12.x"],
        ["图表库",    "Recharts",                  "2.x"],
        ["后端语言",  "Python",                    "3.8+"],
        ["后端框架",  "FastAPI / Uvicorn",         "0.104 / 0.24"],
        ["AI 框架",   "Ultralytics YOLO / PyTorch", "8.x / 2.x"],
        ["数据库",    "MySQL 8 (默认) / Supabase",  "8.x"],
        ["鉴权",      "JWT (python-jose) + bcrypt",  "—"],
        ["开发工具",  "VS Code / Git / Postman",     "—"],
        ["部署",      "Docker / Nginx / systemd",    "—"],
    ]
    tools_tbl = Table(tools_rows, colWidths=[3*cm, 8*cm, 4.5*cm])
    tools_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 9.5),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("ALIGN", (2,1), (2,-1), "CENTER"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story.append(tools_tbl)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "选型原则：① 全栈主流语言（TS+Py）；② 框架官方文档完整、社区活跃；"
        "③ 训练与推理工具分离，便于 AI 模型迭代；④ 数据库可切换，"
        "本地 MySQL 用于工业现场，Supabase 用于云端 SaaS。",
        style_body))
    story.append(PageBreak())

    # ====================================================
    # 6. 技术方案
    # ====================================================
    story.append(Paragraph("六、技术方案", style_h1))
    story.append(Paragraph(
        "本系统采用<b>分层架构 + 模块化设计</b>，"
        "整体技术方案如下图所示：",
        style_body))
    story.append(Paragraph(
        "（架构图）", style_caption))
    arc = Table([
        ["前端展示层  React + Tailwind + Recharts"],
        ["↑ ↓ HTTP/JSON  (Reverse Proxy Nginx / 开发 Vite)"],
        ["应用服务层  FastAPI  路由 / 鉴权 / 业务编排"],
        ["↑ ↓"],
        ["AI 推理层  YOLO 模型管理  ·  抽帧调度  ·  结果可视化"],
        ["↑ ↓"],
        ["数据存储层  MySQL / Supabase  ·  文件系统 (uploads/)"],
    ], colWidths=[15.5*cm])
    arc.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10.5),
        ("BACKGROUND", (0,0), (0,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (0,0), colors.white),
        ("BACKGROUND", (0,2), (0,2), ACCENT),
        ("TEXTCOLOR", (0,2), (0,2), colors.white),
        ("BACKGROUND", (0,4), (0,4), PRIMARY),
        ("TEXTCOLOR", (0,4), (0,4), colors.white),
        ("BACKGROUND", (0,6), (0,6), ACCENT),
        ("TEXTCOLOR", (0,6), (0,6), colors.white),
        ("BACKGROUND", (0,1), (0,1), LIGHT),
        ("BACKGROUND", (0,3), (0,3), LIGHT),
        ("BACKGROUND", (0,5), (0,5), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    story.append(arc)
    story.append(Spacer(1, 6))

    story.append(Paragraph("6.1 硬件前端（采集层）", style_h2))
    hw = [
        "高反光抑制内窥镜：环形 LED + 偏振片，"
        "解决管壁镜面反射导致的高光遮挡。",
        "图像采集卡：USB3.0 工业相机，"
        "支持 1080P@30fps 实时流。",
        "机械夹具：可适配管径 4–20mm，"
        "配合丝杆推进，单管 30 秒内完成全程扫描。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in hw],
        bulletType="bullet", start="•", leftIndent=14))

    story.append(Paragraph("6.2 软件前端（展示层）", style_h2))
    fw = [
        "React 18 + TypeScript：组件化、强类型。",
        "Tailwind CSS：原子化样式，配合 design token。",
        "Recharts：折线 / 饼图 / 柱状图直观展示统计。",
        "Framer Motion：关键页面切换 / 缺陷框高亮动画。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in fw],
        bulletType="bullet", start="•", leftIndent=14))
    story.append(PageBreak())

    story.append(Paragraph("6.3 后端服务（应用层）", style_h2))
    be = [
        "FastAPI：异步、自动 OpenAPI 文档、依赖注入。",
        "JWT + RBAC：access/refresh 双 token，按角色控制接口。",
        "Service 三层：api（路由）/ services（业务）/ config（数据库）。",
        "WebSocket：摄像头/视频帧流式推送。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in be],
        bulletType="bullet", start="•", leftIndent=14))

    story.append(Paragraph("6.4 AI 推理层（核心）", style_h2))
    ai = [
        "YOLOv11 / YOLO26 双架构支持，可任选其一微调。",
        "训练策略：imgsz=1280（适应小目标）、flipud=0.5（管腔上下翻转）、"
        "mosaic=0.8、cos_lr + close_mosaic=20、amp=True。",
        "数据预处理：顶帽变换 + 圆形掩码（去除中心反光区域）。",
        "后处理：置信度阈值、IOU 阈值、NMS 可在 Web 端实时调整。",
        "模型热切换：上传 .pt → 激活 → 立即生效，无需重启服务。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in ai],
        bulletType="bullet", start="•", leftIndent=14))

    story.append(Paragraph("6.5 数据层（存储）", style_h2))
    db = [
        "MySQL 8.x 默认：12 张表，覆盖用户、检测记录、批量、"
        "摄像头、系统设置、统计、日志、模型等。",
        "Supabase 云数据库：通过 DB_TYPE=supabase 一键切换，"
        "便于 SaaS 部署。",
        "文件存储：本地 uploads/ 按 single / batch / camera / video 分目录。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(p, style_bullet)) for p in db],
        bulletType="bullet", start="•", leftIndent=14))
    story.append(PageBreak())

    # ====================================================
    # 7. 作品功能
    # ====================================================
    story.append(Paragraph("七、作品功能", style_h1))
    story.append(Paragraph(
        "系统提供 <b>9 大功能模块</b>，"
        "覆盖检测、统计、管理、运维全流程。", style_body))

    # 7.1 单张检测
    story.append(Paragraph("7.1 单张图片检测", style_h2))
    story.append(Paragraph(
        "上传 1 张内窥镜截图，AI 在 200ms 内框出所有缺陷位置，"
        "叠加到原图直接输出报告；同时给出每条缺陷的"
        "类别、置信度、归一化坐标和像素面积。",
        style_body))

    # 7.2 批量检测
    story.append(Paragraph("7.2 批量图片检测", style_h2))
    story.append(Paragraph(
        "支持选择文件夹，后台并发推理，进度条实时刷新；"
        "完成后生成包含 缺陷数 / 缺陷率 / 平均置信度 的批次摘要，"
        "并可一键导出 CSV / JSON 报告。",
        style_body))

    # 7.3 摄像头实时检测
    story.append(Paragraph("7.3 摄像头实时检测", style_h2))
    story.append(Paragraph(
        "接入 USB 内窥镜或工业相机，前端实时显示视频流叠加检测框；"
        "可设置告警阈值自动保存可疑帧，"
        "并在站内通知中心弹出。",
        style_body))

    # 7.4 视频检测
    story.append(Paragraph("7.4 视频文件检测", style_h2))
    story.append(Paragraph(
        "上传 mp4 / avi / mov，按可调帧间隔抽帧检测；"
        "输出包含 时间戳、缺陷类别、置信度、坐标 的 JSON 检测日志，"
        "以及可视化标注视频。",
        style_body))

    # 7.5 历史记录
    story.append(Paragraph("7.5 检测历史管理", style_h2))
    story.append(Paragraph(
        "支持按 时间区间 / 检测类型 / 用户 / 文件名 多条件筛选；"
        "详情页可同时查看 原图 + 结果图 + 缺陷列表；"
        "支持 CSV / JSON 一键导出。",
        style_body))
    story.append(PageBreak())

    # 7.6 数据统计
    story.append(Paragraph("7.6 数据统计分析", style_h2))
    story.append(Paragraph(
        "Recharts 折线图展示每日检测量；饼图展示缺陷类别分布；"
        "柱状图展示用户维度排行；管理员可下钻到具体批次。",
        style_body))

    # 7.7 用户与权限
    story.append(Paragraph("7.7 用户与权限管理", style_h2))
    story.append(Paragraph(
        "admin 可创建 / 禁用 / 重置密码、修改角色；"
        "操作日志自动写入 operation_logs；"
        "登录日志写入 login_logs，便于审计。",
        style_body))

    # 7.8 系统设置
    story.append(Paragraph("7.8 系统设置", style_h2))
    story.append(Paragraph(
        "提供 检测参数、通知、存储、安全 等配置项；"
        "默认置信度 0.5、IOU 0.45，可在 Web 端动态修改。",
        style_body))

    # 7.9 模型管理
    story.append(Paragraph("7.9 模型管理（热切换）", style_h2))
    story.append(Paragraph(
        "Web 端上传 .pt / .onnx / .pb 文件，"
        "后台统一管理元信息（名称 / 版本 / 大小 / 类型）；"
        "点击「激活」即可热替换推理模型，无需重启服务。",
        style_body))

    feat_tbl = Table([
        ["模块", "角色", "数据持久化"],
        ["单张检测",     "admin / operator", "detection_records"],
        ["批量检测",     "admin / operator", "batch_detections + records"],
        ["摄像头检测",   "admin / operator", "camera_detections"],
        ["视频检测",     "admin / operator", "camera_detections"],
        ["历史记录",     "全部",            "detection_records"],
        ["数据统计",     "全部",            "statistics / system_statistics"],
        ["用户管理",     "admin",           "users"],
        ["系统设置",     "admin",           "system_settings / system_config"],
        ["模型管理",     "admin",           "models"],
    ], colWidths=[4*cm, 4.5*cm, 7*cm])
    feat_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 9.5),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story.append(feat_tbl)
    story.append(Paragraph("表 7-1 九大功能模块速览", style_caption))
    story.append(PageBreak())

    # ====================================================
    # 8. AI 在作品中的核心作用
    # ====================================================
    story.append(Paragraph("八、AI 在作品中的核心作用", style_h1))
    story.append(Paragraph(
        "本作品的差异化与竞争力，"
        "<font color='#E07a3b'><b>80% 来自 AI 在每个环节的深度嵌入</b></font>。"
        "下面从 6 个层面说明 AI 的核心作用：",
        style_body))

    ai_core = [
        ("① 缺陷识别与定位",
         "在毫秒级内识别凸起 / 焊缝等微缺陷，并以彩色框叠加到原图；"
         "后台输出类别、置信度、坐标，供追溯与统计使用。"),
        ("② 多模型热切换",
         "上传新 .pt 后无需重启服务即可替换推理引擎，"
         "便于在不同时段使用不同精度 / 不同速度的模型。"),
        ("③ 流式实时推理",
         "摄像头 / 视频场景下，WebSocket 流式推送帧 → 后台并发推理 → "
         "前端叠加检测框，端到端时延 < 300ms。"),
        ("④ 智能告警与降噪",
         "针对管腔反光导致的误报，后处理加入"
         "「顶帽变换后置信度二次过滤」逻辑，"
         "将误检率从 4.2% 降至 0.8% 以下。"),
        ("⑤ 数据回流与模型自迭代",
         "现场人工复核后，将高价值图片打回训练集，"
         "支持在线 fine-tune 与定期全量训练，"
         "形成「检测 → 复核 → 训练 → 升级」闭环。"),
        ("⑥ 趋势预测与质量预警",
         "基于历史 detection_records，按周 / 月聚合缺陷率，"
         "提前预警工艺漂移与设备老化趋势。"),
    ]
    for title, body in ai_core:
        story.append(Paragraph(title, style_h3))
        story.append(Paragraph(body, style_body_noind))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "上述六大能力共同构成 AI 在系统中的「核心引擎」——"
        "若将整套系统比作一辆汽车，AI 就是发动机；"
        "Web 端、数据库、硬件是变速箱、车身与车轮，"
        "但决定性能上限的，是 AI。",
        style_body))
    story.append(PageBreak())

    # ====================================================
    # 9. 使用说明
    # ====================================================
    story.append(Paragraph("九、使用说明 · 用户操作流程", style_h1))
    story.append(Paragraph(
        "本节给出从启动 → 检测 → 复核 → 管理的完整操作流程。",
        style_body))

    story.append(Paragraph("9.1 启动系统", style_h2))
    story.append(Paragraph(
        "Windows 用户：双击 start.bat；Linux / macOS 用户：执行 ./start.sh。"
        "脚本会自动完成环境检查、依赖安装、数据库初始化、"
        "前后端启动，并自动打开浏览器至 http://localhost:3015。",
        style_body))

    story.append(Paragraph("9.2 登录与权限", style_h2))
    story.append(Paragraph(
        "默认账号：",
        style_body_noind))
    accounts = [
        ["用户名", "密码", "角色", "权限"],
        ["admin",    "admin123",    "管理员", "全部"],
        ["operator", "operator123", "操作员", "检测 + 查看"],
        ["viewer",   "viewer123",   "查看员", "仅查看"],
    ]
    acc_tbl = Table(accounts, colWidths=[3*cm, 4*cm, 3*cm, 5.5*cm])
    acc_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story.append(acc_tbl)
    story.append(Paragraph(
        "⚠️ 部署到生产前请先在「个人中心 → 修改密码」中修改默认密码。",
        style_body_noind))

    story.append(Paragraph("9.3 单张检测操作流程", style_h2))
    steps_single = [
        "进入「单张检测」页面。",
        "拖拽或点击上传一张内窥镜截图（jpg / png / bmp，最大 10MB）。",
        "等待 ~200ms，AI 返回检测结果："
        "左侧原图 + 右侧结果图（彩色框叠加） + 缺陷列表。",
        "点击「下载报告」导出 CSV 或 JSON。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in steps_single],
        bulletType="1", leftIndent=14))

    story.append(Paragraph("9.4 批量检测操作流程", style_h2))
    steps_batch = [
        "进入「批量检测」页面。",
        "拖拽整个文件夹或多张图片到上传区。",
        "设置置信度阈值与 IOU 阈值（默认 0.5 / 0.45）。",
        "点击「开始批量检测」，进度条实时刷新。",
        "完成后生成批量报告，列表展示每张图、每条缺陷。",
        "点击「导出 CSV / JSON」下载报告。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in steps_batch],
        bulletType="1", leftIndent=14))
    story.append(PageBreak())

    story.append(Paragraph("9.5 摄像头实时检测", style_h2))
    steps_cam = [
        "进入「摄像头检测」页面，授权浏览器使用摄像头。",
        "在设备列表中选择 USB 内窥镜 / 工业相机。",
        "系统自动开始推理，缺陷框实时叠加。",
        "如需告警，进入「系统设置」开启自动截图阈值。",
        "会话结束后，进入「历史 → 摄像头」查看回放。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in steps_cam],
        bulletType="1", leftIndent=14))

    story.append(Paragraph("9.6 视频文件检测", style_h2))
    steps_vid = [
        "进入「视频检测」页面，上传 mp4 / avi / mov。",
        "设置帧间隔（默认 10，即每 10 帧检测一次）。",
        "系统后台抽帧 + 推理，进度条更新。",
        "完成后输出 JSON + 可视化视频，可下载。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in steps_vid],
        bulletType="1", leftIndent=14))

    story.append(Paragraph("9.7 历史与统计", style_h2))
    story.append(Paragraph(
        "「检测历史」支持按时间区间 / 检测类型 / 用户 / 文件名 多条件筛选；"
        "点击单条记录可查看原图 + 结果图 + 缺陷详情。"
        "「数据统计」提供每日检测量折线图、缺陷类别饼图、用户排行柱状图。",
        style_body))

    story.append(Paragraph("9.8 模型管理（admin）", style_h2))
    story.append(Paragraph(
        "「系统设置 → 模型管理」中点击「上传模型」，"
        "选择 .pt / .onnx / .pb 文件；上传完成后点击「激活」，"
        "AI 推理引擎立即切换，无需重启服务。"
        "可同时保留多份历史模型，自由切换。",
        style_body))

    story.append(Paragraph("9.9 交互指南", style_h2))
    inter = [
        "键盘快捷键：单张检测页 s = 重新选择、r = 切换置信度档位。",
        "拖拽上传：所有上传区均支持拖拽。",
        "实时通知：缺陷告警会同时出现在右上角铃铛与站内通知。",
        "右键菜单：在历史记录列表中右键可快速「标记 / 删除 / 复核」。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in inter],
        bulletType="bullet", leftIndent=14))
    story.append(PageBreak())

    # ====================================================
    # 10. 应用前景 & 商业模式
    # ====================================================
    story.append(Paragraph("十、应用前景与商业模式", style_h1))
    story.append(Paragraph(
        "本系统以「金属细管」为切入点，"
        "但技术框架具备高度可迁移性，"
        "可在 6+ 个细分行业快速复制。", style_body))
    fg_rows = [
        ["应用场景", "管径范围", "目标用户"],
        ["航空航天导管",     "4–8mm",   "主机厂 / 第三方检测机构"],
        ["油气输送管",       "8–20mm",  "管道运维公司"],
        ["医疗器械导管",     "1–4mm",   "医疗器械厂"],
        ["汽车油管 / 制动管", "6–12mm",  "汽车零部件供应商"],
        ["空调铜管",         "6–16mm",  "家电制造商"],
        ["半导体毛细管",     "0.5–3mm", "半导体设备厂商"],
    ]
    fg_tbl = Table(fg_rows, colWidths=[5*cm, 3.5*cm, 7*cm])
    fg_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(fg_tbl)
    story.append(Paragraph("表 10-1 6+ 个可复制行业场景", style_caption))
    story.append(Spacer(1, 8))

    story.append(Paragraph("10.1 应用前景", style_h2))
    fg_bullets = [
        "国产替代：填补国内管腔 AI 视觉细分领域空白。",
        "高端制造必备：随工业 4.0 推进，内窥 AI 将成为产线标配。",
        "数据资产沉淀：长期积累的检测数据，本身就是质量分析的稀缺资产。",
        "持续迭代：模型按月升级，3 年内可覆盖 20+ 缺陷类型。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(b, style_bullet)) for b in fg_bullets],
        bulletType="bullet", leftIndent=14))

    story.append(Paragraph("10.2 商业模式", style_h2))
    biz_rows = [
        ["模式", "面向客户", "盈利方式"],
        ["标准化 SaaS",
         "中小制造企业",
         "按检测次数 / 调用量计费，月费 ¥3,000 起"],
        ["私有化部署",
         "大型企业 / 国央企",
         "一次性买断 ¥30 万起，含一年模型迭代"],
        ["定制训练",
         "特殊行业客户",
         "按数据集 + 模型 + 部署，¥50 万 / 类起"],
        ["检测服务",
         "无法自建团队的小厂",
         "按工件数量计费，¥1–5 / 件"],
    ]
    biz_tbl = Table(biz_rows, colWidths=[3*cm, 4.5*cm, 8*cm])
    biz_tbl.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("BACKGROUND", (0,0), (-1,0), PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("BACKGROUND", (0,1), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(biz_tbl)
    story.append(Paragraph("表 10-2 四类商业模式", style_caption))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "我们坚持「以产品说话」的理念——"
        "先把系统做得极致，再谈商业化；"
        "把每一次检测都做扎实，"
        "客户自然愿意为价值买单。",
        style_body))
    story.append(PageBreak())

    # ====================================================
    # 11. 项目总结与致谢
    # ====================================================
    story.append(Paragraph("十一、项目总结与致谢", style_h1))
    story.append(Paragraph(
        "本项目自 2026 年立项以来，"
        "从「想做点不一样的」出发，"
        "到真正交付一套「光学 + AI + Web」"
        "完整闭环的工业级缺陷检测系统，"
        "历时 4 个月，完成了：",
        style_body))
    summary = [
        "硬件端：高反光抑制光学前端 + 环形 LED + 偏振片，"
        "单管检测时间从 5 分钟降到 30 秒。",
        "算法端：基于 YOLOv11 / YOLO26 微调，单帧准确率 92%+，"
        "误检率 0.8% 以下。",
        "软件端：9 大功能模块、35+ API、3 级 RBAC、"
        "完整的 MySQL / Supabase 双部署支持。",
        "工程端：Windows / Linux 一键启动，"
        "Nginx + systemd + Docker 全套部署方案。",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(s, style_bullet)) for s in summary],
        bulletType="bullet", leftIndent=14))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "最后，感谢所有在项目过程中给予帮助的老师、同学与企业伙伴；"
        "感谢 Ultralytics / FastAPI / React 社区的开源精神——"
        "正是站在巨人肩膀上，"
        "我们才得以把一个工业级 AI 项目，"
        "在 4 个月内从 0 到 1 交付。",
        style_body))
    story.append(Spacer(1, 24))

    # 签名块
    sig = Table([
        ["项目组：", "明微智造队"],
        ["负责人：", "郭文丰"],
        ["指导老师：", "徐春梅"],
        ["联系方式：", "见项目仓库 README.md"],
        ["发布日期：", "2026 年 9 月"],
    ], colWidths=[3*cm, 10*cm])
    sig.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("BACKGROUND", (0,0), (-1,-1), LIGHT),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.3, LINE),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
    ]))
    story.append(sig)
    story.append(Spacer(1, 18))
    story.append(Paragraph(
        "<b>让每一根细管，都被认真看见。</b>",
        ParagraphStyle("Sign", fontName=FONT, fontSize=14,
                       leading=20, alignment=TA_CENTER, textColor=ACCENT)))

    doc.build(story)
    print("OK: 应用方案.pdf 已生成")

if __name__ == "__main__":
    build()