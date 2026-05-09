# Deploying E·Shady on Render

## Prerequisites
- GitHub account
- Render account (free tier available)

## Steps

1. **Push code to GitHub**:
   - Ensure all files are committed and pushed to your GitHub repository.

2. **Connect to Render**:
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New" > "Web Service"
   - Connect your GitHub repo

3. **Configure Service**:
   - **Name**: ece-140b-api
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r app/requirements.txt`
   - **Start Command**: `uvicorn app.server_api_fastapi:app --host 0.0.0.0 --port $PORT`

4. **Set Environment Variables**:
   - `DATABASE_URL`: Your PostgreSQL database URL (Render provides this)
   - `ESHADY_SECRET_KEY`: A secure random string (generate with `openssl rand -hex 32`)

5. **Deploy**:
   - Click "Create Web Service"
   - Render will build and deploy automatically

6. **Access Your App**:
   - Once deployed, visit the provided URL
   - Register a user and start adding stations

## Notes
- Database will be created automatically on first run
- Free tier has usage limits