import multer from "multer";
import multerS3 from "multer-s3";
import { s3 } from "../services/s3Service.js";

const bucketName = "contact-management-system-uploads";

export const uploadProfilePic = multer({
  storage: multerS3({
    s3: s3,
    bucket: bucketName,
    acl: "public-read",
    key: function (req, file, cb) {
      const fileName = `profiles/${Date.now()}-${file.originalname}`;
      cb(null, fileName);
    }
  })
});

export const uploadSingleProfilePic = uploadProfilePic.single("profilePic");
