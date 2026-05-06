import logging

logger = logging.getLogger(__name__)


def extract_text(file_path: str, ext: str) -> str:
    ext = ext.lower().lstrip(".")
    try:
        if ext == "pdf":
            return _extract_pdf(file_path)
        elif ext == "docx":
            return _extract_docx(file_path)
        elif ext == "csv":
            return _extract_csv(file_path)
        elif ext in ("xlsx", "xls"):
            return _extract_excel(file_path)
        else:
            return _extract_txt(file_path)
    except Exception as e:
        logger.error(f"Text extraction failed for {file_path}: {e}")
        return ""


def _extract_pdf(path: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(path)
    pages = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            pages.append(t)
    return "\n\n".join(pages)


def _extract_docx(path: str) -> str:
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_txt(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def _extract_csv(path: str) -> str:
    import pandas as pd
    df = pd.read_csv(path)
    return df.to_string(index=False)


def _extract_excel(path: str) -> str:
    import pandas as pd
    sheets = pd.read_excel(path, sheet_name=None)
    parts = []
    for name, df in sheets.items():
        parts.append(f"Sheet: {name}\n{df.to_string(index=False)}")
    return "\n\n".join(parts)
