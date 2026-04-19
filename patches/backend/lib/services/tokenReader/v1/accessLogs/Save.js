/* eslint-disable func-style */
/* eslint-disable camelcase,no-template-curly-in-string */
import path from 'path';
import fs   from 'fs';

import mime                                     from 'mime-types';
import _Uniq                                    from 'lodash/uniq';

import config                                   from '../../../../config.js';
import Workspace                                from '../../../../models/Workspace.js';
import AccessLog, { INITIATOR_TYPES }           from '../../../../models/AccessLog';
import AccessSubject, { VIRTUAL_CODE_PREFIXES } from '../../../../models/AccessSubject';
import AccessSubjectToken                       from '../../../../models/AccessSubjectToken';
import AccessTokenReader                        from '../../../../models/AccessTokenReader.js';
import LogRecordedFrame                         from '../../../../models/LogRecordedFrame.js';
import LogRecordedVideo                         from '../../../../models/LogRecordedVideo.js';
import Notification                             from '../../../../models/Notification';
import sequelize                                from '../../../../sequelize';
import s3Client, { BUCKET_NAME }                from '../../../../utils/s3Client.js';
import { waitForMediaFileIntegrity }            from '../../../../utils/media.js';
import { sleep }                                from '../../../../utils/common.js';
import { MILLISECONDS_IN_SECOND }               from '../../../../constants/common.js';
import Base                                     from '../../../Base';

export const VIRTUAL_CODE_PREFIXES_TO_INITIATOR_TYPES = {
    [VIRTUAL_CODE_PREFIXES.SBJ] : INITIATOR_TYPES.SUBJECT,
    [VIRTUAL_CODE_PREFIXES.PHN] : INITIATOR_TYPES.PHONE
};

const BUTTON_CODE_PREFFIX = 'btn';
const BUTTON_CODE_SUFFIX = 'exit';

export const SPECIAL_CODES = {
    // is used to know that the reader was opened using open button
    BUTTON_CODE : `${BUTTON_CODE_PREFFIX}-${BUTTON_CODE_SUFFIX}`,
    // is used to know that alarm sensor was triggered
    ALARM_CODE  : 'alarm'
};

const CODE_PREFIXES_TO_INITIATOR_TYPES = {
    [BUTTON_CODE_PREFFIX]      : INITIATOR_TYPES.BUTTON,
    [SPECIAL_CODES.ALARM_CODE] : INITIATOR_TYPES.ALARM
};

const CAMERAS_MEDIA_COLLECT_FRAMES_INTERVAL_TIME =
    +config.camerasMedia.collectFramesIntervalTime * MILLISECONDS_IN_SECOND;
const CAMERAS_MEDIA_COLLECT_FRAMES_ACCURACY_TIME =
    +config.camerasMedia.collectFramesAccuracyTime * MILLISECONDS_IN_SECOND;
const CAMERAS_MEDIA_VIDEO_SEGMENT_TIME =
    +config.camerasMedia.videoSegmentTime * MILLISECONDS_IN_SECOND;

export default class AccessLogsSave extends Base {
    static validationRules = {
        body : [ 'required', 'string' ]
    };

    // eslint-disable-next-line no-unused-vars
    async execute({ body }) {
        try {
            const notificationsRecords = [];
            const { tokenReaderId : accessTokenReaderId } = this.context;

            if (this.logger) this.logger.info({ accessTokenReaderId, body });

            const { attempts, accessSubjectVirtualTokens } = this._parseBody(body);

            // saved 0 logs response
            if (!attempts.length) return 'ok,0';

            const accessSubjects_hash = {};
            const accessSubjectTokens_hash = {};

            if (this.logger) this.logger.info({ accessSubjectVirtualTokens });

            const accessSubjects = await AccessSubject.findAll({
                where : { virtualCode: _Uniq(accessSubjectVirtualTokens) }
            });

            const accessSubjectTokens = await AccessSubjectToken.findAll({
                where   : { code: _Uniq(attempts.map(({ code }) => code)) },
                include : [ {
                    association : AccessSubjectToken.AssociationAccessSubject,
                    required    : false
                } ]
            });

            accessSubjects.forEach(accessSubject => {
                accessSubjects_hash[accessSubject.virtualCode] = accessSubject;
            });
            accessSubjectTokens.forEach(accessSubjectToken => {
                accessSubjectTokens_hash[accessSubjectToken.code] = accessSubjectToken;
            });

            const ACCESS_ATTEMPTS = Notification.types.ACCESS_ATTEMPTS;

            const records = attempts.map(({ time, code, status }) => {
                const map = code.split('-');
                const codePreffix = map[0];

                const notificationType = ACCESS_ATTEMPTS.UNAUTH_ACCESS;
                const initiatorType = CODE_PREFIXES_TO_INITIATOR_TYPES[codePreffix] || INITIATOR_TYPES.ACCESS_POINT;
                const notification = {
                    accessTokenReaderId,
                    accessSubjectId      : null,
                    accessSubjectTokenId : null,
                    type                 : notificationType,
                    message              : '', // this should be removed in future. deprecated column
                    data                 : {
                        tokenCode : code
                    }
                };
                const record = {
                    accessTokenReaderId,
                    accessSubjectTokenId : null,
                    accessSubjectId      : null,
                    status,
                    initiatorType,
                    attemptedAt          : time
                };

                // special codes don't require additional processing unlike codes that are related,
                // for example, to subjects
                if (AccessLogsSave.isSpecialCode(code)) {
                    // create notification for each log with "alarm" code depending on log status
                    if (code === SPECIAL_CODES.ALARM_CODE) {
                        notificationsRecords.push({
                            ...notification,
                            type : status === AccessLog.STATUS_ALARM_ON ?
                                ACCESS_ATTEMPTS.SECURITY_SYSTEM_ACCESS_ON : ACCESS_ATTEMPTS.SECURITY_SYSTEM_ACCESS_OFF
                        });
                    }
                    // currently, there is no need to create notification for the access log related to open button:
                    // if (status === AccessLog.STATUS_DENIED) notificationsRecords.push(notification);

                    return record;
                }

                // case for virtual tokens
                // Example: sbj-QWERTY, phn-QWERTY
                if (map.length === 2) {
                    if (Object.values(VIRTUAL_CODE_PREFIXES).includes(codePreffix)) {
                        const accessSubject = accessSubjects_hash[map[1]];

                        if (!accessSubject) {
                            if (this.logger) this.logger.warn(`Cannot find subject with id(${map[1]}). Skip.`);

                            return null;
                        }

                        const typeToPrefix = {
                            [VIRTUAL_CODE_PREFIXES.SBJ] : ACCESS_ATTEMPTS.UNAUTH_SUBJECT_ACCESS,
                            [VIRTUAL_CODE_PREFIXES.PHN] : ACCESS_ATTEMPTS.UNAUTH_SUBJECT_PHN_ACCESS
                        };

                        if (status === AccessLog.STATUS_DENIED) {
                            notificationsRecords.push({
                                accessTokenReaderId,
                                accessSubjectId      : accessSubject.id,
                                accessSubjectTokenId : null,
                                type                 : typeToPrefix[codePreffix],
                                data                 : {},
                                message              : '' // this should be removed in future. deprecated column
                            });
                        }

                        return {
                            accessTokenReaderId,
                            accessSubjectTokenId : null,
                            accessSubjectId      : accessSubject.id,
                            status,
                            initiatorType        : VIRTUAL_CODE_PREFIXES_TO_INITIATOR_TYPES[codePreffix],
                            attemptedAt          : time
                        };
                    }

                    return null;
                }

                const accessSubjectToken = accessSubjectTokens_hash[code];

                if (!accessSubjectToken) {
                    if (this.logger) this.logger.warn(`Cannot find code(${code}). Skip.`);

                    notificationsRecords.push({
                        accessTokenReaderId,
                        type : Notification.alwaysEnabledTypes.UNKNOWN_TOKEN,
                        data : {
                            tokenCode : code
                        },
                        message : '' // this should be removed in future. deprecated column
                    });

                    return null;
                }

                notification.accessSubjectTokenId = accessSubjectToken.id;
                record.accessSubjectTokenId = accessSubjectToken.id;

                // TODO: (accessSubjectToken.assignedAt < time) not sure in this
                if (accessSubjectToken.accessSubject && (accessSubjectToken.assignedAt < time)) {
                    notification.accessSubjectId = accessSubjectToken.accessSubject.id;
                    record.accessSubjectId = accessSubjectToken.accessSubject.id;
                }

                if (
                    status === AccessLog.STATUS_DENIED ||
                    status === AccessLog.STATUS_ALARM
                ) {
                    notificationsRecords.push(notification);
                }

                return record;
            }).filter(v => v);

            let createdLogs = null;

            await sequelize.transaction(async transaction => {
                createdLogs = await AccessLog.bulkCreate(records, { transaction });

                if (notificationsRecords.length) {
                    await Promise.all(notificationsRecords.map(r => Notification.create(r, { transaction })));
                }
            });

            const workspace = await Workspace.findByPkOrFail(this.context.workspaceId);

            const cameras = await AccessTokenReader.findAll({
                where : {
                    id : accessTokenReaderId
                },
                include : [
                    {
                        association : 'accessCameras',
                        where       : {
                            enabled    : true,
                            isArchived : false,
                            deletedAt  : null
                        }
                    }
                ],
                raw : true
            });

            if (workspace.allowCollectMedia && cameras?.length) {
                this.uploadLogsRecordedMediaToS3(createdLogs);
            }


            return `ok,${records.length}`;
        } catch (e) {
            throw e;
        }
    }

    // !Important: to boost uploading time need to implement parallel uploading of all streams
    async uploadLogsRecordedMediaToS3(logs) {
        // Waits for a collecting interval time + some accuracy time(frames are not created in one moment) multiplied
        // by 2 to collect the next 2 frames that is not already collected at this moment. There is probable case
        // when the next collected frame will be nearest to a log time and we have to wait one more frame(2 at all)
        const timeToWaitNextFrames = (
            CAMERAS_MEDIA_COLLECT_FRAMES_INTERVAL_TIME +
            CAMERAS_MEDIA_COLLECT_FRAMES_ACCURACY_TIME
        ) * 2;

        await sleep(timeToWaitNextFrames);

        for (const log of logs) {
            await sequelize.transaction(async transaction => {
                const tokenReader = await AccessTokenReader.findOne({
                    where   : { id: log.accessTokenReaderId },
                    include : [
                        {
                            association : AccessTokenReader.AssociationAccessCamera,
                            required    : true
                        }
                    ]
                });
                const [ camera ] = tokenReader.accessCameras;
                const time = log.attemptedAt.getTime();
                const framesPaths = await camera.getFramesNearestToTime(time);
                const videosPaths = await camera.getVideosNearestToTime(time);
                // Probable case to implement in the future - don't upload and save frames with videos
                // when there are some frames but are not any videos and vice versa
                const successfullyUploadedObjects = [];
                const tasks = [];

                try {
                    for (const framePath of framesPaths) {
                        const uploadTask = async () => {
                            const { base: fileName, name: fileNameWithoutExtension } = path.parse(framePath);
                            const frameStream = fs.createReadStream(framePath);

                            const { Key } = await s3Client.uploadAsync({
                                Bucket      : BUCKET_NAME,
                                Key         : `cameras/${camera.getRtspUrlHash()}/frames/${fileName}`,
                                Body        : frameStream,
                                ContentType : mime.lookup(fileName)
                            });

                            successfullyUploadedObjects.push({ Key });

                            // Video files are named with UNIX timestamp of its creation time as base name, because
                            // probably(tested on MacOS) there is no way to check file's creation time that was
                            // mounted with Docker volume.
                            // Example: '1634997883000.mp4'
                            const fileCreationTime = +fileNameWithoutExtension;
                            // The time which was in the RTSP stream when started recording frame:
                            // ffmpeg utility records 1/60 part of frame per second and after one minute
                            // it writes frame to a file with current system timestamp in name(not the actual time when
                            // started recording this frame)
                            const fileStartedRecordingAt = fileCreationTime -
                                CAMERAS_MEDIA_COLLECT_FRAMES_INTERVAL_TIME;

                            await LogRecordedFrame.create({
                                logId           : log.id,
                                objectKey       : Key,
                                originCreatedAt : fileStartedRecordingAt
                            }, { transaction });
                        };

                        tasks.push(uploadTask);
                    }

                    for (const videoPath of videosPaths) {
                        const uploadTask = async () => {
                            // Wait only for video files integrity because the frames are created atomically
                            await waitForMediaFileIntegrity(videoPath, { timeout: CAMERAS_MEDIA_VIDEO_SEGMENT_TIME });

                            const { base: fileName, name: fileNameWithoutExtension } = path.parse(videoPath);
                            const videoStream = fs.createReadStream(videoPath);

                            const { Key } = await s3Client.uploadAsync({
                                Bucket      : BUCKET_NAME,
                                Key         : `cameras/${camera.getRtspUrlHash()}/videos/${fileName}`,
                                Body        : videoStream,
                                ContentType : mime.lookup(fileName)
                            });

                            successfullyUploadedObjects.push({ Key });

                            // Video files are named with UNIX timestamp of its creation time as base name, because
                            // probably(tested on MacOS) there is no way to check file's creation time that was
                            // mounted with Docker volume.
                            // Example: '1634997883000.mp4'
                            const fileCreationTime = +fileNameWithoutExtension;

                            await LogRecordedVideo.create({
                                logId           : log.id,
                                objectKey       : Key,
                                originCreatedAt : fileCreationTime
                            }, { transaction });
                        };

                        tasks.push(uploadTask);
                    }

                    // Upload media in parallel
                    await Promise.all(tasks.map(task => task()));
                } catch (err) {
                    this.logger.warn(`uploadLogsRecordedMediaToS3 error: ${err.message}`);
                    this.logger.info(
                        'uploadLogsRecordedMediaToS3 ' +
                        `try to remove uploaded media: ${JSON.stringify(successfullyUploadedObjects)}`
                    );

                    await s3Client
                        .deleteObjectsAsync({
                            Bucket : BUCKET_NAME,
                            Delete : {
                                Objects : successfullyUploadedObjects
                            }
                        })
                        .catch(cleanupErr => {
                            this.logger.warn(`uploadLogsRecordedMediaToS3 cleanup failed: ${cleanupErr.message}`);
                        });

                    // To rollback the transaction
                    throw err;
                }
            }).catch(err => {
                this.logger.error(`uploadLogsRecordedMediaToS3 transaction failed for logId=${log.id}: ${err.message}`, err);
            });
        }
    }

    static isSpecialCode(code) {
        return Object.values(SPECIAL_CODES).includes(code);
    }

    _parseBody(body) {
        const attempts = [];
        const accessSubjectVirtualTokens = [];

        body.split(',').forEach((access_str) => {
            // Example: 1597925395_3DFCDFCF_1,1597925396_sbj-QWERTY_0
            const [ timestampInSeconds, token, code ] = access_str.split('_');

            let time = timestampInSeconds === '0' ? new Date() : new Date(parseInt(timestampInSeconds, 10) * 1000);

            const weekInMs = 7 * 24 * 60 * 60 * 1000;

            // sometimes access point can send log from future (2035 year logs)
            if (time - new Date() > weekInMs) {
                time = new Date();

                if (this.logger) this.logger.warn(`*** LOG FROM FUTURE: ${access_str}. Attempt will be saved with time: ${time}`);
            }

            if (isNaN(time)) {
                if (this.logger) this.logger.warn(`WRONG OF ACCESS LOG STRING(${access_str}), time is invalid. Skip.`);

                return;
            }

            let status;

            switch (code) {
                case '1':
                    status = token === SPECIAL_CODES.ALARM_CODE ?
                        AccessLog.STATUS_ALARM_ON : AccessLog.STATUS_SUCCESS;
                    break;
                case '0':
                    status = token === SPECIAL_CODES.ALARM_CODE ?
                        AccessLog.STATUS_ALARM_OFF : AccessLog.STATUS_DENIED;
                    break;
                default:
                    if (this.logger) this.logger.warn(`WRONG OF ACCESS LOG STRING(${access_str}), status is invalid. Skip.`);

                    return;
            }

            const map = token.split('-');

            if (map.length === 2) {
                if (Object.values(VIRTUAL_CODE_PREFIXES).includes(map[0])) accessSubjectVirtualTokens.push(map[1]);
            }

            attempts.push({ time, code: token, status });
        });

        return { attempts, accessSubjectVirtualTokens };
    }
}
