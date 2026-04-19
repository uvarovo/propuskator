import Base from '../../Base';
import Workspace from '../../../models/Workspace';
import Notification from '../../../models/Notification';
import { getTimezoneNames, getTimezoneInfoByName } from '../../utils/timezones';
import { dumpWorkspaceSettings } from '../../utils/dumps';
import { ValidationError } from '../../utils/SX';

export default class UpdateWorkspaceSettings extends Base {
    static validationRules = {
        notificationTypes : [ {
            'list_of' : [ 'string', { 'one_of': Object.keys(Notification.types) } ] }, 'list_items_unique' ],
        timezone          : [ { 'one_of': getTimezoneNames() } ],
        allowCollectMedia : [ 'boolean' ]
    };

    async execute({ notificationTypes, timezone, allowCollectMedia }) {
        const workspaceId = this.cls.get('workspaceId');

        const workspace = await Workspace.findOne({ where: { id: workspaceId } });

        if (!workspace) throw new ValidationError(ValidationError.codes.WORKSPACE_NOT_FOUND, { field: 'workspace' });

        if (timezone !== undefined && timezone !== null) {
            // Stock UI submits numeric UTC offsets; coerce to canonical string label.
            if (typeof timezone === 'number') {
                const info = getTimezoneInfoByName(timezone);

                if (info) timezone = info.text;
            }
            if (timezone) workspace.timezone = timezone;
        }
        if (notificationTypes) workspace.notificationTypes = Workspace.notificationTypesToString(notificationTypes);
        if (typeof allowCollectMedia === 'boolean') workspace.allowCollectMedia = allowCollectMedia;

        await workspace.save();

        await workspace.reload();

        return {
            data : dumpWorkspaceSettings({
                ...workspace.dataValues,
                notificationTypes : Workspace.notificationTypesToArray(workspace.notificationTypes)
            })
        };
    }
}
