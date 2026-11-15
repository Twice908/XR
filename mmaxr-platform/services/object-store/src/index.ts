import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const upload = multer({ storage: multer.memoryStorage() });

const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'admin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'password',
  },
});

const BUCKET_NAME = 'mmaxr-telemetry';

async function storeObject(buffer: Buffer, originalname: string, mimetype: string) {
  const filename = `${Date.now()}-${originalname}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filename,
    Body: buffer,
    ContentType: mimetype,
  }));
  return {
    message: 'Upload successful',
    url: `${process.env.S3_ENDPOINT || 'http://localhost:9000'}/${BUCKET_NAME}/${filename}`,
    filename,
  };
}

// Ensure bucket exists on startup
async function initBucket() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`✅ Bucket ${BUCKET_NAME} already exists.`);
  } catch (err: any) {
    if (err.$metadata?.httpStatusCode === 404) {
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`✅ Created missing bucket: ${BUCKET_NAME}`);
    } else {
      console.error(`❌ Error checking bucket:`, err);
    }
  }
}
initBucket();

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      if (!res.headersSent) return res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const storedObject = await storeObject(req.file.buffer, req.file.originalname, req.file.mimetype);

    console.log(`[MinIO] Uploaded ${storedObject.filename}`);
    
    if (!res.headersSent) {
      res.status(200).json(storedObject);
    }
  } catch (err: any) {
    console.error('❌ Object Store Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to upload file' });
    }
  }
});

app.post('/upload/base64', async (req, res) => {
  try {
    const { filename, contentType, fileBase64 } = req.body ?? {};
    if (
      typeof filename !== 'string' || !filename ||
      typeof contentType !== 'string' || !contentType ||
      typeof fileBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fileBase64)
    ) {
      return res.status(400).json({ error: 'Invalid base64 upload payload' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.toString('base64') !== fileBase64) {
      return res.status(400).json({ error: 'Invalid base64 upload payload' });
    }

    const storedObject = await storeObject(buffer, filename, contentType);
    console.log(`[MinIO] Uploaded ${storedObject.filename}`);
    res.status(200).json(storedObject);
  } catch (err: any) {
    console.error('❌ Object Store Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to upload file' });
    }
  }
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`📦 Object Store running on http://localhost:${PORT}`);
});