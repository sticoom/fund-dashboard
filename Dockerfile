FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/*.py .

COPY --from=frontend /build/dist /app/frontend_dist

RUN mkdir -p /app/frontend_dist/data

ENV EXCEL_PASSWORD=delamu
EXPOSE 8000

CMD ["python", "server.py", "--prod"]
