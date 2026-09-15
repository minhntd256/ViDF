# System Setup Guide

This guide explains how to set up and run the system ViDF, which relies on two locally hosted vLLM model servers (Qwen and InternVL) plus a Docker Compose stack.

## Prerequisites

- Docker and Docker Compose installed
- GPU(s) available for hosting the vLLM model servers
- Hugging Face token (`HF_TOKEN`)
- Tavily API key (`TAVILY_API_KEY`)

## Step 1: Host the vLLM Model Servers

Before starting the main system, you must first host two vLLM servers:

1. **Qwen** — serve your chosen Qwen model with vLLM.
2. **InternVL** — serve your chosen InternVL model with vLLM.

Once both servers are running, note down their base URLs and model names — you will need them in the next step.

> Example (adjust to your actual model and hardware setup):
> ```bash
> vllm serve <qwen-model-path> --port <port>
> vllm serve <internvl-model-path> --port <port>
> ```

## Step 2: Configure the `.env` File

Create a `.env` file in the folder `backend` with the following variables:

```env
HF_TOKEN=your_huggingface_token
TAVILY_API_KEY=your_tavily_api_key

QWEN_BASE_URL=http://<qwen-host>:<port>
QWEN_MODEL=Qwen/<model-name>

INTERNVL_BASE_URL=http://<internvl-host>:<port>
INTERNVL_MODEL=<internvl-model-name>
```

Replace the placeholder values with the actual URLs and model names from Step 1, along with your API keys.

## Step 3: Start the System with Docker Compose

In folder `backend`. Build and start the containers:

```bash
docker compose up --build
```

Wait until all services report as healthy/running.

## Step 4: Access the System

Once the containers are up, open your browser and go to:

```
http://localhost:8080
```

The system should now be accessible and ready to use.

