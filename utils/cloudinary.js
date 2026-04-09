import { v2 as cloudinary } from "cloudinary";
import * as dotenv from "dotenv";

dotenv.config();

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET)
  );

if (isCloudinaryConfigured()) {
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({
      secure: true,
    });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
}

const uploadImageToCloudinary = async (filePath, options = {}) => {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured");
  }

  return cloudinary.uploader.upload(filePath, {
    resource_type: "image",
    folder: process.env.CLOUDINARY_FOLDER || "gym-members",
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    ...options,
  });
};

const getOptimizedCloudinaryImageUrl = (publicId, options = {}) => {
  if (!publicId) return "";

  return cloudinary.url(publicId, {
    secure: true,
    fetch_format: "auto",
    quality: "auto:good",
    width: 600,
    height: 600,
    crop: "limit",
    ...options,
  });
};

export { isCloudinaryConfigured, uploadImageToCloudinary, getOptimizedCloudinaryImageUrl };
