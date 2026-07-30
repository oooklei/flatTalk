try:
    import docx
    has_docx = True
except Exception as e:
    has_docx = False
try:
    import openpyxl
    has_xlsx = True
except Exception as e:
    has_xlsx = False
print("docx:", has_docx)
print("openpyxl:", has_xlsx)
