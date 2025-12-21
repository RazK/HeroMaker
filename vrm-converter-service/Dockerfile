# Use Ubuntu as the base to handle Blender's system dependencies
FROM ubuntu:22.04

# Version information
ARG VERSION=1.0.0
LABEL version="${VERSION}"
LABEL maintainer="HeroMaker"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# 1. Install Blender and Linux Graphics Libraries
RUN apt-get update && apt-get install -y \
    blender \
    curl \
    unzip \
    libgl1 \
    libxxf86vm1 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    python3-pip \
    python3-numpy \
    && rm -rf /var/lib/apt/lists/*

# 2. Install FastAPI dependencies and numpy for Blender
RUN pip3 install fastapi uvicorn python-multipart numpy

# 3. Install numpy for Blender's Python (required by glTF importer)
# Blender uses its own Python, so we install numpy using Blender's Python pip
RUN blender --background --python-expr "import subprocess, sys; subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'numpy'])"

# 4. Install the VRM Addon for Blender
# Copy the locally downloaded addon zip file and extract it
COPY downloads/add-on-vrm-v3.17.2.zip /tmp/vrm_addon.zip
RUN mkdir -p /usr/share/blender/scripts/addons/io_scene_vrm \
    && unzip /tmp/vrm_addon.zip -d /usr/share/blender/scripts/addons/io_scene_vrm \
    && rm /tmp/vrm_addon.zip

# Note: VRM addon will be enabled by the conversion script when needed

WORKDIR /app

# Copy application files (relative to dockerfile location)
COPY vrm-converter-service/app.py .
COPY vrm-converter-service/conversion_script.py .

# Expose the FastAPI port
EXPOSE 8000

# Start the service
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

