import ServiceBase                    from 'chista/ServiceBase';
import AccessLog, { INITIATOR_TYPES } from '../../../models/AccessLog';
// import AccessSubjectToken from '../../../models/AccessSubjectToken';
import { dumpAccessLog }  from '../../utils/dumps';
import DX from '../../../models/utils/DX';
import cls from '../../../cls';

export default class AccessLogList extends ServiceBase {
    static validationRules = {
        ids                   : [ { 'list_of': 'db_id' }, 'fixed_not_empty_list' ],
        search                : [ 'string', { 'max_length': 255 } ],
        accessSubjectTokenIds : [ { 'list_of': 'db_id' } ],
        accessTokenReaderIds  : [ { 'list_of': 'db_id' } ],
        accessSubjectIds      : [ { 'list_of': 'db_id' } ],
        status                : [ 'string', 'trim', 'to_uc', { 'one_of': [ AccessLog.STATUS_SUCCESS, AccessLog.STATUS_DENIED, AccessLog.STATUS_ALARM ] } ],
        createStart           : [ 'is_date' ],
        createEnd             : [ 'is_date', { 'date_after_field': 'createStart' } ],
        limit                 : [ 'positive_integer' ],
        offset                : [ 'integer', { 'default': 0 }, { 'min_number': 0 } ],
        sortedBy              : [
            'string',
            {
                'one_of' : [
                    'attemptedAt',
                    'createdAt',
                    'subjectName',
                    'tokenName',
                    'status',
                    'readerName',
                    'initiatorType'
                ]
            },
            {
                'default' : 'createdAt'
            }
        ],
        order          : [ 'string', 'to_uc', { 'one_of': [ 'ASC', 'DESC' ] }, { 'default': 'DESC' } ],
        initiatorTypes : [ { 'list_of' :
            [ [ 'string', 'trim', { 'one_of': Object.values(INITIATOR_TYPES) } ] ]
        } ]
    };

    async execute(params) {
        try {
            const { accessLogs, count } = await AccessLog.findAllByParams(params);

            return {
                data : accessLogs.map(dumpAccessLog),
                meta : {
                    filteredCount : count,
                    total         : await AccessLog.count({ where: { workspaceId: cls.get('workspaceId') } })
                }
            };
        } catch (e) {
            if (e instanceof DX) {// holly shield
                throw e;
            } else throw e;
        }
    }
}
