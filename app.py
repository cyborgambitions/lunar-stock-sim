"""
LUNARA Web / Render entry point (app.py)
This allows running `python app.py` for the web version.
"""

from server.main import app

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.getenv("PORT", 8765))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
