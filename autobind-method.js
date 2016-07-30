
function isBindAssignment(node) {
    // Returns true if node looks like `this.foo = this.foo.bind(this);`
    node = node.value;
    if (node.type === 'AssignmentExpression') {
        const { type: leftType, property } = node.left;
        if (leftType === 'MemberExpression' && property.type === 'Identifier') {
            const name = property.name;

            const { right } = node;
            if (right.type === 'CallExpression') {
                // callee should be `this.foo.bind`
                const { callee } = right;
                const isBind = callee.type === 'MemberExpression'
                    && callee.object.type === 'MemberExpression'
                    && callee.object.object.type === 'ThisExpression'
                    && callee.object.property.name === name;
                if (!isBind) {
                    return false;
                }

                // arguments should be `[ThisExpression]`
                const { arguments: args } = right;
                if (args.length === 1 && args[0].type === 'ThisExpression') {
                    return true;
                }
                return false;
            }
        }
    }
    return false;
}

const transform = (fileInfo, api, options) => {
    const j = api.jscodeshift;

    function bindMethods(classBody) {
        // Find assignments in the constructor of the form `this.foo = this.foo.bind(this)`
        const constructor = classBody
            .find(j.MethodDefinition, (node) => node.kind === 'constructor');

        const bindAssignments = constructor
            .find(j.AssignmentExpression)
            .filter(isBindAssignment);

        const methodNames = [];
        bindAssignments.forEach((node) => {
            node = node.value;
            methodNames.push(node.left.property.name);
        });

        bindAssignments.forEach((node) => j(node).remove());

        function convertMethodToBoundArrowFunc(method) {
            const name = method.value.key;

            const { params, body } = method.value.value;
            const arrowFunc = j.arrowFunctionExpression(
                params,
                body,
            );
            const classProp = j.classProperty(
                name,
                arrowFunc,
                null, /* typeAnnotation */
                false, /* static */
            );
            classProp.comments = method.value.comments;
            return classProp;
        }

        classBody
            .find(j.MethodDefinition, (node) => node.kind === 'method' && methodNames.includes(node.key.name))
            .replaceWith(convertMethodToBoundArrowFunc);
    }

    const ast = j(fileInfo.source);
    const classes = ast.find(j.ClassDeclaration);
    classes.forEach(_class => bindMethods(j(_class)));
    return ast.toSource({
        arrowParensAlways: true,
    });
};

export default transform;
