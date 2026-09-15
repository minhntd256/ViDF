FROM pytorch/pytorch:2.7.0-cuda12.8-cudnn9-runtime


RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    git-lfs \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


COPY requirements-mt.txt .
RUN pip install --no-cache-dir -r requirements-mt.txt
RUN ct2-transformers-converter --model facebook/nllb-200-distilled-600M \
    --output_dir /app/models/nllb-200-distilled-600M-ct2 \
    --quantization int8_float16


COPY requirements.txt .


RUN pip install --no-cache-dir -r requirements.txt


RUN pip install --no-cache-dir tensorflow-cpu
RUN pip install --no-cache-dir "transnetv2 @ git+https://github.com/soCzech/TransNetV2.git#main"

COPY . .

EXPOSE 8080

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8080"]
