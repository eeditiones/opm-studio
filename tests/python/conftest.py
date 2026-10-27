# the module runs in Pyodide from src/runtime; import it from there
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src' / 'runtime'))
