// services/s3Service.js
import { S3 } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const SPACES_ENDPOINT_HOST = "blr1.digitaloceanspaces.com";

export const s3 = new S3({
  endpoint: `https://${SPACES_ENDPOINT_HOST}`,
  region: "blr1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
  // DigitalOcean Spaces doesn't support the AWS SDK v3's default checksum
  // trailers (flexible checksums), which causes "InvalidArgument: UnknownError"
  // on upload. Only compute checksums when the API actually requires them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// multer-s3's `req.file.location` is computed via a buggy internal endpoint
// resolution step with this SDK version + custom-endpoint combo, and comes
// back missing the "https://" scheme (see: DB records with profilePicUrl
// like "blr1.digitaloceanspaces.com/bucket/key..."). Build the public URL
// ourselves from the bucket/key we already control instead of trusting it.
export function buildSpacesPublicUrl(bucket, key) {
  return `https://${bucket}.${SPACES_ENDPOINT_HOST}/${key}`;
}
