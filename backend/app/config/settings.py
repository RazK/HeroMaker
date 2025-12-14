import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./heromaker.db")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
ASSETS_ROOT = os.getenv("ASSETS_ROOT", "../assets")

