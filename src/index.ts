import express from 'express';
import bodyparser from 'body-parser'
import dotenv from 'dotenv';
import cors from 'cors';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage'
import * as AWS from 'aws-sdk'
import multer from 'multer';
dotenv.config();
const app = express();

//can give limit in json
app.use(bodyparser.json());
app.use(cors());
const s3 = new S3Client({
    region: process.env?.AWS_BUCKET_REGION as string,
    credentials: {
        secretAccessKey: process.env?.AWS_SECRET_KEY as string,
        accessKeyId: process.env.AWS_ACCESS_KEY as string
    },
    // useAccelerateEndpoint: true
});

const awsCredentials = new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY as string,
    secretAccessKey: process.env?.AWS_SECRET_KEY as string,
});

const AWS_S3 = new AWS.S3({
    region: "ap-southeast-1",
    credentials: awsCredentials,
    // useAccelerateEndpoint:true
});
const bucket_name = process.env.BUCKET_NAME;

app.get('/health', (req, res, next) => {
    res.send({ health: 'ok' })
})

const upload = multer();
app.post('/upload_parrallel', upload.any(), async (req, res, next) => {

    try {
        const file = req.files as Express.Multer.File[];
        console.log({ file });
        const params = {
            Bucket: bucket_name,
            Key: `${new Date().toString()}_${file[0].originalname}`,
            Body: file[0].buffer
        }
        console.log("params", params, s3);
        const parrallel_uploader = new Upload({
            client: s3,
            queueSize: 4, // default is 4
            partSize: 5242880,//5mb by default
            leavePartsOnError: true,//by default false
            params: params
        });
        // console.log("sdfa");
        console.log('parrallel_uploader', parrallel_uploader);
        parrallel_uploader.on("httpUploadProgress", progress => {
            console.log("httpUploadProgress", progress, new Date());
            // console.log("started")
        });
        // parrallel_uploader.done().then(data => {
        //     console.log("upload completed", { data });
        //     res.send({ status: 'success', data: data });
        // });
        const data = parrallel_uploader.done();
        console.log("given success", new Date());
        res.send({ status: 'success', data: data });
    } catch (error) {
        res.status(500).send({ status: 'failed', err: JSON.stringify(error) });
    }
});


async function multiplartUploader(uploadParams: any) {
    try {
        let data = await AWS_S3.uploadPart(uploadParams).promise();
        return data;
    } catch (error) {
        console.log(`uploadPart:error`, uploadParams, JSON.stringify(error));
        throw new Error('Got error while uploading');
    }
}
app.post('/upload_multipart', upload.any(), async (req, res, next) => {
    try {
        let startTime = new Date();
        let CHUNK_SIZE = 5 * 1024 * 1024;
        const file = req.files as Express.Multer.File[];
        console.log({ file });
        const fileKey = `${new Date().toString()}_${file[0].originalname}`;
        const params = {
            Bucket: bucket_name as string,
            Key: fileKey,
            // Body: file[0].buffer
        }
        //initiate upload
        const uploadStart = await AWS_S3.createMultipartUpload(params).promise();
        console.log("uploadStart", uploadStart.UploadId);
        //upload
        let uploadPromise:any[] = [];
        let total_chunks = Math.ceil(file[0].size / CHUNK_SIZE);
        let end;
        let start = 0;
        for (let i = 0; i < total_chunks; i++) {
            end = start + CHUNK_SIZE;
            let index = i;
            let chunk = file[0].buffer.slice(start, end);
            const uploadParams = {
                Bucket: bucket_name as string,
                Key: fileKey,
                Body: chunk,
                PartNumber: index + 1,
                UploadId: uploadStart.UploadId as string
            }
            uploadPromise.push(multiplartUploader(uploadParams));
            start = end;
        }
        try {
            await Promise.all(uploadPromise);
        } catch (error) {
            console.log(`uploadPromise:error`, JSON.stringify(error));
            throw new Error('Got error while uploadPromise');
        }
        //completion
        const completionParams: any = {
            Bucket: bucket_name as string,
            Key: fileKey,
            UploadId: uploadStart.UploadId as string
        }
        AWS_S3.listParts(completionParams, (err, data) => {
            if (err) {
                console.log(`listParts:error`, err);
                throw new Error('Got error while listing parts');
            }
            let parts: any = [];
            data.Parts?.forEach(part => {
                parts.push({
                    ETag: part.ETag,
                    PartNumber: part.PartNumber
                });
            });
            completionParams["MultipartUpload"] = {
                Parts: parts
            };
            AWS_S3.completeMultipartUpload(completionParams, (err, data) => {
                if (err) {
                    console.log(`completeMultipartUpload:error`, err);
                    throw new Error('Got error while completeMultipartUpload parts');
                }
                let endTime = new Date();

                console.log("completeMultipartUpload", data, endTime);
                return res.send({ status: 'success', data: data });
            });
        });
    } catch (error) {
        res.status(500).send({ status: 'failed', err: JSON.stringify(error) });
    }
});


app.listen(8080, () => {
    console.log("Server started @ 8080")
})
//InvalidRequest: S3 Transfer Acceleration is not configured on this bucket