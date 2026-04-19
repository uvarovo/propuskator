/* eslint-disable max-len */
import Base              from '../../Base';
import AdminUser         from '../../../models/AdminUser';
import Workspace         from '../../../models/Workspace';
import AccessSchedule    from '../../../models/AccessSchedule';
import { dumpAdminUser } from '../../utils/dumps';
import sequelize from '../../../sequelizeSingleton';
import { generateToken } from '../sessions/utils';
import { getTimezoneNames, getTimezoneInfoByName } from '../../utils/timezones';
import DX from '../../../models/utils/DX';
import { ValidationError } from '../../utils/SX';

export default class AdminUserRegister extends Base {
    static validationRules = {
        workspace       : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 50 }, { 'fixed_min_length': 3 },  { 'custom_error_code': [ 'WRONG_WORKSPACE_NAME_FORMAT', 'like', '^[a-z0-9]+$' ] }  ],
        // email           : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 255 }, { 'fixed_min_length': 1 },  'fixed_email' ],
        login           : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 255 }, { 'fixed_min_length': 1 }, 'fixed_email' ],
        timezone        : [ { 'one_of': getTimezoneNames() } ],
        password        : [ 'required', 'string', 'trim', 'not_empty', { 'fixed_max_length': 255 }, { 'fixed_min_length': 1 }, 'password' ],
        passwordConfirm : [ 'required', 'string', 'trim', 'not_empty', { 'equal_to_field': 'password' } ],
        avatarImg       : [ { 'nested_object' : {
            buffer       : [ 'required' ],
            mimetype     : [ 'required', 'string', { 'one_of': [ 'image/png', 'image/jpg', 'image/jpeg' ] } ],
            originalname : [ 'required', 'string' ]
        } } ]
    }

    async execute({ workspace, avatarImg, timezone, ...data }) {
        // UI submits `timezone` as a numeric UTC offset in hours; coerce to canonical
        // string label so Workspace.timezone stores a stable, human-readable value.
        if (typeof timezone === 'number') {
            const info = getTimezoneInfoByName(timezone);

            if (info) timezone = info.text;
        }

        try {
            let dbAdminUser = null;

            await sequelize.transaction(async transaction => {
                const { id:  workspaceId } = await Workspace.create({ name: workspace, timezone });

                dbAdminUser = await AdminUser.create({
                    ...data,
                    workspaceId
                }, { transaction });

                await AccessSchedule.create({
                    name                : 'Full access',
                    workspaceId,
                    accessScheduleDates : [ {
                        from               : null,
                        to                 : null,
                        weekBitMask        : 127,
                        monthBitMask       : null,
                        dailyIntervalStart : 0,
                        dailyIntervalEnd   : 86340000
                    } ]
                }, {
                    include : [ AccessSchedule.AssociationAccessScheduleDates ],
                    transaction
                });
                await AccessSchedule.create({
                    name                : 'Working hours',
                    workspaceId,
                    accessScheduleDates : [ {
                        from               : null,
                        to                 : null,
                        weekBitMask        : 124,
                        monthBitMask       : null,
                        dailyIntervalStart : 28800000,
                        dailyIntervalEnd   : 72000000
                    } ]
                }, {
                    include : [ AccessSchedule.AssociationAccessScheduleDates ],
                    transaction
                });
                await AccessSchedule.create({
                    name                : 'Weekends',
                    workspaceId,
                    accessScheduleDates : [ {
                        from               : null,
                        to                 : null,
                        weekBitMask        : 3,
                        monthBitMask       : null,
                        dailyIntervalStart : 0,
                        dailyIntervalEnd   : 86340000
                    } ]
                }, {
                    include : [ AccessSchedule.AssociationAccessScheduleDates ],
                    transaction
                });

                await dbAdminUser.reload({ transaction });
            });

            if (typeof avatarImg === 'object') await dbAdminUser.setAvatarImage(avatarImg);

            return {
                data : dumpAdminUser(dbAdminUser),
                meta : {
                    token : await generateToken(dbAdminUser)
                }
            };
        } catch (e) {
            if (e instanceof DX) {
                if (e instanceof DX.UniqueConstraintError) {
                    if (e.modelName === 'Workspace' && Object.keys(e.fields).length === 1 && Object.keys(e.fields)[0] === 'name') {
                        throw new ValidationError(ValidationError.codes.WORKSPACE_NAME_IS_USED, { field: 'workspace' });
                    } else if (e.modelName === 'MqttUser' && Object.keys(e.fields).length === 1 && Object.keys(e.fields)[0] === 'username') {
                        throw new ValidationError(ValidationError.codes.ADMIN_LOGIN_IS_USED, { field: 'login' });
                    } else {
                        throw e;
                    }
                } else {
                    throw e;
                }
            } else throw e;
        }
    }
}
